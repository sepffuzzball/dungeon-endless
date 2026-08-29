import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { requireUser } from '$lib/server/authorization';
import { assertSameOrigin } from '$lib/server/csrf';
import { db } from '$lib/server/db';
import { deriveStats, resolveRunBaseStats } from '$lib/server/game';
import {
	fallbackProse,
	fallbackRoomEntry,
	streamProse,
	streamRoomEntry,
	summarizeTurn
} from '$lib/server/llm';
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

function prompt(run: typeof runs.$inferSelect, character: typeof characters.$inferSelect) {
	return buildSystemPrompt({
		brutality: run.brutality - 1,
		debauchery: run.debauchery - 1,
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

	const [owned] = await db
		.select({ run: runs, character: characters })
		.from(runs)
		.innerJoin(characters, and(eq(runs.characterId, characters.id), eq(characters.userId, user.id)))
		.where(and(eq(runs.id, runId.data), eq(runs.userId, user.id)))
		.limit(1);
	if (!owned) throw error(404, 'Run not found.');

	const initial =
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
	if (!initial) throw error(404, 'Narration not found.');

	const aborter = new AbortController();
	const signal = AbortSignal.any([event.request.signal, aborter.signal]);
	const encoder = new TextEncoder();
	let closed = false;
	let clientDisconnected = false;
	let activeLease: Date | null = null;
	let leaseLost = false;
	let producerFinished = false;
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
	event.request.signal.addEventListener(
		'abort',
		() => {
			clientDisconnected = true;
			aborter.abort();
			void releaseLease();
		},
		{ once: true }
	);

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
				controller.close();
			};
			keepaliveTimer = setInterval(() => send(formatSseComment()), HEARTBEAT_MS);
			overallTimer = setTimeout(() => aborter.abort(), OVERALL_WAIT_MS);

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
							aborter.abort();
						}
					})()
						.catch(() => aborter.abort())
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
						accumulated = turn.narration;
						send(formatSseEvent('snapshot', { text: accumulated }));
						if (accumulated) throw new Error('Recovered partial narration');
						for await (const chunk of streamProse({
							system: prompt(owned.run, owned.character),
							room: turn.roomSnapshot,
							actionText: turn.actionText,
							outcome: turn.outcome,
							endpoints,
							signal
						})) {
							accumulated += chunk.content;
							const saved = await db
								.update(turns)
								.set({ narration: accumulated, narrationUpdatedAt: new Date() })
								.where(and(eq(turns.id, turn.id), eq(turns.narrationStartedAt, activeLease)))
								.returning({ id: turns.id });
							if (!saved.length) {
								leaseLost = true;
								aborter.abort();
								return;
							}
							send(formatSseEvent('chunk', { text: chunk.content }));
						}
						const completed = await db
							.update(turns)
							.set({ narrationStatus: 'complete', narrationUpdatedAt: new Date() })
							.where(and(eq(turns.id, turn.id), eq(turns.narrationStartedAt, activeLease)))
							.returning({ id: turns.id });
						if (!completed.length) {
							leaseLost = true;
							aborter.abort();
							return;
						}
						producerFinished = true;
						if (heartbeatTimer) clearInterval(heartbeatTimer);
						void (async () => {
							const summary = await summarizeTurn({
								system: prompt(owned.run, owned.character),
								room: turn.roomSnapshot,
								actionText: turn.actionText,
								outcome: turn.outcome,
								endpoints
							});
							await Promise.all([
								db
									.update(turns)
									.set({ turnSummary: summary })
									.where(and(eq(turns.id, turn.id), eq(turns.narrationStartedAt, activeLease))),
								db
									.update(runs)
									.set({ summary })
									.where(
										and(
											eq(runs.id, owned.run.id),
											eq(runs.userId, user.id),
											eq(runs.version, turn.sequence)
										)
									)
							]);
						})().catch(() => undefined);
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
							accumulated ||= fallbackRoomEntry(entry.roomSnapshot, '');
							const saved = await db
								.update(roomEntries)
								.set({ prose: accumulated, status: 'failed', updatedAt: new Date() })
								.where(and(eq(roomEntries.id, entry.id), eq(roomEntries.startedAt, activeLease)))
								.returning({ id: roomEntries.id });
							if (!saved.length) return;
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
							signal
						})) {
							accumulated += chunk.content;
							const saved = await db
								.update(roomEntries)
								.set({ prose: accumulated, updatedAt: new Date() })
								.where(and(eq(roomEntries.id, entry.id), eq(roomEntries.startedAt, activeLease)))
								.returning({ id: roomEntries.id });
							if (!saved.length) {
								leaseLost = true;
								aborter.abort();
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
							aborter.abort();
							return;
						}
						producerFinished = true;
					}
					send(formatSseEvent('done', { status: 'complete' }));
				} catch {
					if (leaseLost) return;
					if (clientDisconnected || event.request.signal.aborted) {
						await releaseLease();
						return;
					}
					const fallback =
						kind === 'turn'
							? await (async () => {
									const [turn] = await db
										.select()
										.from(turns)
										.where(eq(turns.id, targetId))
										.limit(1);
									return turn
										? fallbackProse(turn.roomSnapshot, turn.actionText, turn.outcome)
										: 'The dungeon falls silent.';
								})()
							: await (async () => {
									const [entry] = await db
										.select()
										.from(roomEntries)
										.where(eq(roomEntries.id, targetId))
										.limit(1);
									return entry
										? fallbackRoomEntry(entry.roomSnapshot, '')
										: 'The chamber waits in silence.';
								})();
					accumulated ||= fallback;
					const saved =
						kind === 'turn'
							? await db
									.update(turns)
									.set({
										narration: accumulated,
										narrationStatus: 'failed',
										narrationUpdatedAt: new Date()
									})
									.where(and(eq(turns.id, targetId), eq(turns.narrationStartedAt, activeLease)))
									.returning({ id: turns.id })
							: await db
									.update(roomEntries)
									.set({ prose: accumulated, status: 'failed', updatedAt: new Date() })
									.where(and(eq(roomEntries.id, targetId), eq(roomEntries.startedAt, activeLease)))
									.returning({ id: roomEntries.id });
					if (!saved.length) return;
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
			})().catch(() => finish());
		},
		cancel() {
			clientDisconnected = true;
			closed = true;
			if (keepaliveTimer) clearInterval(keepaliveTimer);
			if (heartbeatTimer) clearInterval(heartbeatTimer);
			if (overallTimer) clearTimeout(overallTimer);
			aborter.abort();
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
