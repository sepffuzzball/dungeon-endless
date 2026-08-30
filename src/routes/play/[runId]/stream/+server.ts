import { randomUUID } from 'node:crypto';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { requireUser } from '$lib/server/authorization';
import { assertSameOrigin } from '$lib/server/csrf';
import { db } from '$lib/server/db';
import { deriveStats, normalizeNarrationMode, resolveRunBaseStats } from '$lib/server/game';
import {
	fallbackProse,
	fallbackRoomEntry,
	fallbackSummary,
	streamProse,
	streamRoomEntry,
	summarizeTurn
} from '$lib/server/llm';
import {
	classifyLlmFailure,
	LlmFailure,
	logLlmFallback,
	logLlmRouteError,
	type LlmDiagnosticContext,
	type LlmRouteErrorInput
} from '$lib/server/llm-diagnostics';
import {
	formatSseComment,
	formatSseEvent,
	isNarrationLeaseStale,
	persistedSuffix
} from '$lib/server/narration';
import { buildSystemPrompt } from '$lib/server/prompts';
import { characters, llmEndpoints, roomEntries, runs, turns } from '$lib/server/schema';
import type { RequestHandler } from './$types';

const uuidSchema = z.string().uuid();
const LEASE_MS = 30_000;
const HEARTBEAT_MS = 8_000;
const FOLLOWER_POLL_MS = 500;
const OVERALL_WAIT_MS = 120_000;

export function _outerRouteDiagnostic(
	kind: 'turn' | 'room',
	diagnostics: LlmDiagnosticContext,
	failure: unknown
): LlmRouteErrorInput | null {
	const reason = classifyLlmFailure(failure, 'database_or_route_error');
	if (reason === 'client_disconnect' || reason === 'lease_lost') return null;
	return {
		purpose: kind === 'turn' ? 'prose' : 'room_prose',
		reason,
		...diagnostics
	};
}

/**
 * Logs one sanitized route error for an unexpected ownership or target lookup
 * database failure that happens before the guarded producer starts, then
 * rethrows the original failure so the request keeps its normal error path.
 * Only safe correlation, run, target and kind context is emitted; the raw
 * failure is never serialized. Expected 400/401/403 and 404 outcomes are not
 * routed through here.
 */
export function _preStreamDatabaseRouteError(
	diagnostics: LlmDiagnosticContext,
	failure: unknown
): never {
	const diagnostic: LlmRouteErrorInput = {
		purpose: diagnostics.narrationKind === 'room' ? 'room_prose' : 'prose',
		reason: 'database_or_route_error',
		...diagnostics
	};
	try {
		logLlmRouteError(diagnostic);
	} catch {
		// Diagnostics must never prevent request handling.
	}
	throw failure;
}

function prompt(run: typeof runs.$inferSelect, character: typeof characters.$inferSelect) {
	return buildSystemPrompt({
		brutality: run.brutality,
		debauchery: run.debauchery,
		adventurer: {
			name: character.name,
			title: character.title,
			species: character.species,
			className: character.className,
			level: run.meta.startLevel ?? run.roomData.run?.startLevel ?? character.level
		}
	});
}

const wait = (ms: number, signal: AbortSignal) =>
	new Promise<void>((resolve) => {
		const timer = setTimeout(resolve, ms);
		signal.addEventListener(
			'abort',
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true }
		);
	});

/**
 * Atomically publishes the final turn narration, summary and terminal status under
 * the producer's lease. Locks the owned run, then the exact turn, verifies the
 * lease still belongs to this producer, and only then writes the durable
 * narration, turn summary and final status, publishing run.summary only when the
 * run still points at this turn. No LLM or network call happens inside the
 * transaction; prose and summary must be generated beforehand.
 */
async function finalizeTurnNarration(input: {
	runId: string;
	userId: string;
	turnId: string;
	lease: Date;
	status: 'complete' | 'failed';
	narration: string;
	summary: string;
}): Promise<boolean> {
	const { runId, userId, turnId, lease, status, narration, summary } = input;
	return db.transaction(async (tx) => {
		const [run] = await tx
			.select()
			.from(runs)
			.where(and(eq(runs.id, runId), eq(runs.userId, userId)))
			.limit(1)
			.for('update');
		if (!run) return false;
		const [turn] = await tx
			.select()
			.from(turns)
			.where(and(eq(turns.id, turnId), eq(turns.runId, run.id)))
			.limit(1)
			.for('update');
		if (!turn) return false;
		// The lease must still be owned by this producer, otherwise nothing is published.
		if (turn.narrationStatus !== 'streaming' || !turn.narrationStartedAt) return false;
		if (turn.narrationStartedAt.getTime() !== lease.getTime()) return false;
		await tx
			.update(turns)
			.set({
				narration,
				turnSummary: summary,
				narrationStatus: status,
				narrationStartedAt: null,
				narrationUpdatedAt: new Date()
			})
			.where(eq(turns.id, turnId));
		if (run.version === turn.sequence) {
			await tx.update(runs).set({ summary }).where(eq(runs.id, run.id));
		}
		return true;
	});
}

export const GET: RequestHandler = async (event) => {
	if (!event.request.headers.get('accept')?.toLowerCase().includes('text/event-stream')) {
		throw error(406, 'This endpoint requires Accept: text/event-stream.');
	}
	assertSameOrigin(event);
	const user = requireUser(event);
	const runId = uuidSchema.safeParse(event.params.runId);
	const id = uuidSchema.safeParse(event.url.searchParams.get('id'));
	const kind = event.url.searchParams.get('kind');
	if (!runId.success || !id.success || (kind !== 'turn' && kind !== 'room')) {
		throw error(400, 'Invalid narration stream request.');
	}
	const targetId = id.data;
	const diagnostics: LlmDiagnosticContext = {
		correlationId: randomUUID(),
		runId: runId.data,
		targetId,
		narrationKind: kind
	};

	let owned;
	try {
		[owned] = await db
			.select({ run: runs, character: characters })
			.from(runs)
			.innerJoin(
				characters,
				and(eq(runs.characterId, characters.id), eq(characters.userId, user.id))
			)
			.where(and(eq(runs.id, runId.data), eq(runs.userId, user.id)))
			.limit(1);
	} catch (caught) {
		_preStreamDatabaseRouteError(diagnostics, caught);
	}
	if (!owned) throw error(404, 'Run not found.');

	let initial;
	try {
		initial =
			kind === 'turn'
				? (
						await db
							.select({ id: turns.id })
							.from(turns)
							.where(and(eq(turns.id, targetId), eq(turns.runId, owned.run.id)))
							.limit(1)
					)[0]
				: (
						await db
							.select({ id: roomEntries.id })
							.from(roomEntries)
							.where(and(eq(roomEntries.id, targetId), eq(roomEntries.runId, owned.run.id)))
							.limit(1)
					)[0];
	} catch (caught) {
		_preStreamDatabaseRouteError(diagnostics, caught);
	}
	if (!initial) throw error(404, 'Narration not found.');

	const aborter = new AbortController();
	const signal = aborter.signal;
	const encoder = new TextEncoder();
	let closed = false;
	let clientDisconnected = false;
	let activeLease: Date | null = null;
	let leaseLost = false;
	let producerFinished = false;
	let routeDiagnosticLogged = false;
	let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
	let keepaliveTimer: ReturnType<typeof setInterval> | undefined;
	let overallTimer: ReturnType<typeof setTimeout> | undefined;

	async function releaseLease() {
		const lease = activeLease;
		if (!lease || leaseLost || producerFinished) return;
		const now = new Date();
		if (kind === 'turn') {
			await db
				.update(turns)
				.set({
					narrationStatus: 'pending',
					narrationStartedAt: null,
					narrationUpdatedAt: now
				})
				.where(and(eq(turns.id, targetId), eq(turns.narrationStartedAt, lease)));
		} else {
			await db
				.update(roomEntries)
				.set({ status: 'pending', startedAt: null, updatedAt: now })
				.where(and(eq(roomEntries.id, targetId), eq(roomEntries.startedAt, lease)));
		}
	}
	const disconnect = () => {
		clientDisconnected = true;
		aborter.abort(new LlmFailure('client_disconnect', 'Narration client disconnected'));
		void releaseLease();
	};
	if (event.request.signal.aborted) disconnect();
	else event.request.signal.addEventListener('abort', disconnect, { once: true });

	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			const send = (text: string) => {
				if (!closed && !signal.aborted) controller.enqueue(encoder.encode(text));
			};
			const finish = () => {
				if (closed) return;
				closed = true;
				if (keepaliveTimer) clearInterval(keepaliveTimer);
				if (heartbeatTimer) clearInterval(heartbeatTimer);
				if (overallTimer) clearTimeout(overallTimer);
				try {
					controller.close();
				} catch {
					// The consumer may already have canceled the stream.
				}
			};
			keepaliveTimer = setInterval(() => send(formatSseComment()), HEARTBEAT_MS);
			overallTimer = setTimeout(
				() => aborter.abort(new LlmFailure('timeout', 'Narration route timed out')),
				OVERALL_WAIT_MS
			);

			void (async () => {
				const deadline = Date.now() + OVERALL_WAIT_MS;
				let sent = '';
				let initialized = false;

				const claim = async (): Promise<Date | null> => {
					const claimedAt = new Date();
					const staleBefore = new Date(claimedAt.getTime() - LEASE_MS);
					const claimed =
						kind === 'turn'
							? (
									await db
										.update(turns)
										.set({
											narrationStatus: 'streaming',
											narrationStartedAt: claimedAt,
											narrationUpdatedAt: claimedAt
										})
										.where(
											and(
												eq(turns.id, targetId),
												eq(turns.runId, owned.run.id),
												or(
													eq(turns.narrationStatus, 'pending'),
													and(
														eq(turns.narrationStatus, 'streaming'),
														or(
															isNull(turns.narrationUpdatedAt),
															lt(turns.narrationUpdatedAt, staleBefore)
														)
													)
												)
											)
										)
										.returning({ id: turns.id })
								)[0]
							: (
									await db
										.update(roomEntries)
										.set({ status: 'streaming', startedAt: claimedAt, updatedAt: claimedAt })
										.where(
											and(
												eq(roomEntries.id, targetId),
												eq(roomEntries.runId, owned.run.id),
												or(
													eq(roomEntries.status, 'pending'),
													and(
														eq(roomEntries.status, 'streaming'),
														or(
															isNull(roomEntries.updatedAt),
															lt(roomEntries.updatedAt, staleBefore)
														)
													)
												)
											)
										)
										.returning({ id: roomEntries.id })
								)[0];
					return claimed ? claimedAt : null;
				};

				while (!signal.aborted && Date.now() < deadline) {
					const lease = await claim();
					if (lease) {
						activeLease = lease;
						break;
					}
					const row =
						kind === 'turn'
							? (
									await db
										.select({
											text: turns.narration,
											status: turns.narrationStatus,
											updatedAt: turns.narrationUpdatedAt
										})
										.from(turns)
										.where(and(eq(turns.id, targetId), eq(turns.runId, owned.run.id)))
										.limit(1)
								)[0]
							: (
									await db
										.select({
											text: roomEntries.prose,
											status: roomEntries.status,
											updatedAt: roomEntries.updatedAt
										})
										.from(roomEntries)
										.where(and(eq(roomEntries.id, targetId), eq(roomEntries.runId, owned.run.id)))
										.limit(1)
								)[0];
					if (!row) break;
					const suffix = persistedSuffix(sent, row.text);
					if (!initialized || suffix.reset) send(formatSseEvent('snapshot', { text: row.text }));
					else if (suffix.text) send(formatSseEvent('chunk', { text: suffix.text }));
					initialized = true;
					sent = row.text;
					if (row.status === 'complete' || row.status === 'failed') {
						if (row.status === 'failed')
							send(formatSseEvent('error', { message: 'Narration used a saved fallback.' }));
						send(formatSseEvent('done', { status: row.status }));
						finish();
						return;
					}
					if (isNarrationLeaseStale(row.status, row.updatedAt, new Date(), LEASE_MS)) continue;
					await wait(FOLLOWER_POLL_MS, signal);
				}

				if (!activeLease) {
					if (!signal.aborted) {
						send(
							formatSseEvent('error', {
								message: 'Narration is still pending. Reconnect to continue.'
							})
						);
						send(formatSseEvent('done', { status: 'streaming' }));
					}
					finish();
					return;
				}

				let heartbeatBusy = false;
				heartbeatTimer = setInterval(() => {
					if (heartbeatBusy || !activeLease || producerFinished) return;
					heartbeatBusy = true;
					void (async () => {
						const now = new Date();
						const saved =
							kind === 'turn'
								? await db
										.update(turns)
										.set({ narrationUpdatedAt: now })
										.where(and(eq(turns.id, targetId), eq(turns.narrationStartedAt, activeLease)))
										.returning({ id: turns.id })
								: await db
										.update(roomEntries)
										.set({ updatedAt: now })
										.where(
											and(eq(roomEntries.id, targetId), eq(roomEntries.startedAt, activeLease))
										)
										.returning({ id: roomEntries.id });
						if (saved.length === 0) {
							leaseLost = true;
							aborter.abort(new LlmFailure('lease_lost', 'Narration lease was lost'));
						}
					})()
						.catch(() =>
							aborter.abort(new LlmFailure('database_or_route_error', 'Narration heartbeat failed'))
						)
						.finally(() => {
							heartbeatBusy = false;
						});
				}, HEARTBEAT_MS);

				let accumulated = '';
				try {
					const endpoints = await db
						.select()
						.from(llmEndpoints)
						.where(eq(llmEndpoints.enabled, true));
					if (kind === 'turn') {
						const [turn] = await db
							.select()
							.from(turns)
							.where(and(eq(turns.id, targetId), eq(turns.runId, owned.run.id)))
							.limit(1);
						if (!turn) throw new Error('Turn disappeared');
						const narrationMode = normalizeNarrationMode(turn.intent.narrationMode);
						accumulated = turn.narration;
						send(formatSseEvent('snapshot', { text: accumulated }));
						if (accumulated) throw new Error('Recovered partial narration');
						for await (const chunk of streamProse({
							system: prompt(owned.run, owned.character),
							room: turn.roomSnapshot,
							actionText: turn.actionText,
							outcome: turn.outcome,
							rolls: Array.isArray(turn.rolls) ? turn.rolls : [],
							narrationMode,
							endpoints,
							signal,
							diagnostics,
							onFallbackDiagnostic: () => {
								routeDiagnosticLogged = true;
							}
						})) {
							accumulated += chunk.content;
							const saved = await db
								.update(turns)
								.set({ narration: accumulated, narrationUpdatedAt: new Date() })
								.where(and(eq(turns.id, turn.id), eq(turns.narrationStartedAt, activeLease)))
								.returning({ id: turns.id });
							if (!saved.length) {
								leaseLost = true;
								aborter.abort(new LlmFailure('lease_lost', 'Narration lease was lost'));
								return;
							}
							send(formatSseEvent('chunk', { text: chunk.content }));
						}
						let summary = fallbackSummary(
							turn.roomSnapshot,
							turn.actionText,
							turn.outcome,
							narrationMode
						);
						try {
							summary = await summarizeTurn({
								system: prompt(owned.run, owned.character),
								room: turn.roomSnapshot,
								actionText: turn.actionText,
								outcome: turn.outcome,
								narrationMode,
								endpoints,
								diagnostics
							});
						} catch {
							// The deterministic summary remains authoritative when every endpoint fails.
						}
						const won = await finalizeTurnNarration({
							runId: owned.run.id,
							userId: user.id,
							turnId: turn.id,
							lease: activeLease,
							status: 'complete',
							narration: accumulated,
							summary
						});
						if (!won) {
							leaseLost = true;
							aborter.abort(new LlmFailure('lease_lost', 'Narration lease was lost'));
							return;
						}
						producerFinished = true;
						if (heartbeatTimer) clearInterval(heartbeatTimer);
					} else {
						const [current] = await db
							.select({ run: runs, character: characters, entry: roomEntries })
							.from(roomEntries)
							.innerJoin(runs, and(eq(roomEntries.runId, runs.id), eq(runs.userId, user.id)))
							.innerJoin(
								characters,
								and(eq(runs.characterId, characters.id), eq(characters.userId, user.id))
							)
							.where(and(eq(roomEntries.id, targetId), eq(roomEntries.runId, owned.run.id)))
							.limit(1);
						if (!current) throw new Error('Room entry disappeared');
						const { run, character, entry } = current;
						accumulated = entry.prose;
						send(formatSseEvent('snapshot', { text: accumulated }));
						if (
							entry.runVersion !== run.version ||
							entry.roomNumber !== run.roomNumber ||
							entry.roomSnapshot.type !== run.roomType
						) {
							accumulated ||= fallbackRoomEntry(entry.roomSnapshot, run.summary);
							const saved = await db
								.update(roomEntries)
								.set({ prose: accumulated, status: 'failed', updatedAt: new Date() })
								.where(and(eq(roomEntries.id, entry.id), eq(roomEntries.startedAt, activeLease)))
								.returning({ id: roomEntries.id });
							if (!saved.length) return;
							routeDiagnosticLogged = true;
							logLlmFallback({
								purpose: 'room_prose',
								mode: 'route',
								reason: 'room_state_mismatch',
								visibleChars: accumulated.length,
								...diagnostics
							});
							producerFinished = true;
							send(formatSseEvent('snapshot', { text: accumulated }));
							send(formatSseEvent('done', { status: 'failed' }));
							return;
						}
						if (accumulated) throw new Error('Recovered partial narration');
						const level = run.meta.startLevel ?? run.roomData.run?.startLevel ?? character.level;
						const base = resolveRunBaseStats(run.meta, character);
						const stats = deriveStats({
							...base,
							level,
							hp: run.hp,
							maxHp: run.maxHp,
							defense: 5 + level,
							attackBonus: base.body + level,
							inventory: run.inventory
						});
						for await (const chunk of streamRoomEntry({
							system: prompt(run, character),
							room: entry.roomSnapshot,
							runSummary: run.summary,
							character: {
								name: character.name,
								companyName: user.companyName || 'The Endless Company',
								description: character.description,
								height: character.height,
								build: character.build,
								species: character.species,
								calling: character.className,
								stats: { body: stats.body, mind: stats.mind, spirit: stats.spirit }
							},
							inventory: run.inventory,
							endpoints,
							signal,
							diagnostics,
							onFallbackDiagnostic: () => {
								routeDiagnosticLogged = true;
							}
						})) {
							accumulated += chunk.content;
							const saved = await db
								.update(roomEntries)
								.set({ prose: accumulated, updatedAt: new Date() })
								.where(and(eq(roomEntries.id, entry.id), eq(roomEntries.startedAt, activeLease)))
								.returning({ id: roomEntries.id });
							if (!saved.length) {
								leaseLost = true;
								aborter.abort(new LlmFailure('lease_lost', 'Narration lease was lost'));
								return;
							}
							send(formatSseEvent('chunk', { text: chunk.content }));
						}
						const completed = await db
							.update(roomEntries)
							.set({ status: 'complete', updatedAt: new Date() })
							.where(and(eq(roomEntries.id, entry.id), eq(roomEntries.startedAt, activeLease)))
							.returning({ id: roomEntries.id });
						if (!completed.length) {
							leaseLost = true;
							aborter.abort(new LlmFailure('lease_lost', 'Narration lease was lost'));
							return;
						}
						producerFinished = true;
					}
					send(formatSseEvent('done', { status: 'complete' }));
				} catch (caught) {
					if (leaseLost) return;
					if (clientDisconnected || event.request.signal.aborted) {
						await releaseLease();
						return;
					}
					const failure = signal.aborted ? signal.reason : caught;
					const alreadyDiagnosed =
						routeDiagnosticLogged || (failure instanceof LlmFailure && failure.diagnosticLogged);
					if (alreadyDiagnosed) routeDiagnosticLogged = true;
					const routeReason = classifyLlmFailure(failure, 'database_or_route_error');
					let saved: { id: string }[];
					if (kind === 'turn') {
						const [turn] = await db
							.select()
							.from(turns)
							.where(and(eq(turns.id, targetId), eq(turns.runId, owned.run.id)))
							.limit(1);
						const summary = turn
							? fallbackSummary(
									turn.roomSnapshot,
									turn.actionText,
									turn.outcome,
									normalizeNarrationMode(turn.intent.narrationMode)
								)
							: 'The dungeon falls silent.';
						if (!accumulated) {
							accumulated = turn
								? fallbackProse(
										turn.roomSnapshot,
										turn.actionText,
										turn.outcome,
										Array.isArray(turn.rolls) ? turn.rolls : [],
										normalizeNarrationMode(turn.intent.narrationMode)
									)
								: 'The dungeon falls silent.';
						}
						const won = await finalizeTurnNarration({
							runId: owned.run.id,
							userId: user.id,
							turnId: targetId,
							lease: activeLease,
							status: 'failed',
							narration: accumulated,
							summary
						});
						if (!won) return;
						saved = [{ id: targetId }];
					} else {
						const [entry] = await db
							.select()
							.from(roomEntries)
							.where(and(eq(roomEntries.id, targetId), eq(roomEntries.runId, owned.run.id)))
							.limit(1);
						if (!accumulated) {
							accumulated = entry
								? fallbackRoomEntry(entry.roomSnapshot, owned.run.summary)
								: 'The chamber waits in silence.';
						}
						saved = await db
							.update(roomEntries)
							.set({ prose: accumulated, status: 'failed', updatedAt: new Date() })
							.where(and(eq(roomEntries.id, targetId), eq(roomEntries.startedAt, activeLease)))
							.returning({ id: roomEntries.id });
					}
					if (!saved.length) return;
					if (!alreadyDiagnosed) {
						routeDiagnosticLogged = true;
						logLlmFallback({
							purpose: kind === 'turn' ? 'prose' : 'room_prose',
							mode: 'route',
							reason: routeReason,
							visibleChars: accumulated.length,
							...diagnostics
						});
					}
					producerFinished = true;
					send(formatSseEvent('snapshot', { text: accumulated }));
					send(
						formatSseEvent('error', { message: 'The live narration failed; saved text is shown.' })
					);
					send(formatSseEvent('done', { status: 'failed' }));
				} finally {
					if (heartbeatTimer) clearInterval(heartbeatTimer);
					finish();
				}
			})().catch((caught) => {
				const diagnostic = _outerRouteDiagnostic(kind, diagnostics, caught);
				if (diagnostic) {
					routeDiagnosticLogged = true;
					try {
						logLlmRouteError(diagnostic);
					} catch {
						// Diagnostics must never prevent stream cleanup.
					}
				}
				finish();
			});
		},
		cancel() {
			clientDisconnected = true;
			closed = true;
			if (keepaliveTimer) clearInterval(keepaliveTimer);
			if (heartbeatTimer) clearInterval(heartbeatTimer);
			if (overallTimer) clearTimeout(overallTimer);
			aborter.abort(new LlmFailure('client_disconnect', 'Narration client disconnected'));
			void releaseLease();
		}
	});

	return new Response(body, {
		headers: {
			'Content-Type': 'text/event-stream; charset=utf-8',
			'Cache-Control': 'no-store, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
};
