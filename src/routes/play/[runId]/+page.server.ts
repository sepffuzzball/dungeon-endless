import { randomUUID } from 'node:crypto';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { NarrationStatus, PendingNarration, PlayView, RunPhase } from '$lib/types';
import { achievementByKey, eligibleKeys } from '$lib/server/achievements';
import { requireUser } from '$lib/server/authorization';
import { assertSameOrigin } from '$lib/server/csrf';
import { db } from '$lib/server/db';
import {
	checkedCompanyGoldAdd,
	deriveStatBreakdowns,
	deriveStats,
	generateRoom,
	mapActionIntent,
	normalizeActionIntent,
	resolveEncounter,
	resolveRunBaseStats,
	settlementGold,
	toTurnIntent
} from '$lib/server/game';
import {
	fallbackProse,
	fallbackRoomEntry,
	fallbackSuggestions,
	fallbackSummary,
	interpretAction,
	suggestActions
} from '$lib/server/llm';
import { buildSystemPrompt } from '$lib/server/prompts';
import {
	achievements,
	characters,
	llmEndpoints,
	monsters,
	roomEntries,
	runs,
	traps,
	turns,
	userAchievements,
	users
} from '$lib/server/schema';
import type { Actions, PageServerLoad } from './$types';

const uuidSchema = z.string().uuid();
const ACTION_MIN_LENGTH = 1;
const ACTION_MAX_LENGTH = 500;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function formInteger(form: FormData, name: string): number | null {
	const raw = form.get(name);
	if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
	const value = Number(raw);
	return Number.isSafeInteger(value) ? value : null;
}

function systemPrompt(run: typeof runs.$inferSelect, character: typeof characters.$inferSelect) {
	return buildSystemPrompt({
		// Stored charter sliders are persisted as 1..5 and passed through as-is.
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

async function award(
	tx: Transaction,
	userId: string,
	progress: { firstDefeat: boolean; roomNumber: number; gold: number }
) {
	for (const key of eligibleKeys({ entered: true, ...progress })) {
		const definition = achievementByKey(key);
		if (!definition) continue;
		const [achievement] = await tx
			.insert(achievements)
			.values(definition)
			.onConflictDoUpdate({
				target: achievements.key,
				set: { name: definition.name, description: definition.description }
			})
			.returning({ id: achievements.id });
		await tx
			.insert(userAchievements)
			.values({ userId, achievementId: achievement.id })
			.onConflictDoNothing();
	}
}

async function ownedRun(runId: string, userId: string) {
	const [row] = await db
		.select({ run: runs, character: characters })
		.from(runs)
		.innerJoin(characters, and(eq(runs.characterId, characters.id), eq(characters.userId, userId)))
		.where(and(eq(runs.id, runId), eq(runs.userId, userId)))
		.limit(1);
	return row;
}

async function finalizeTurnFallback(tx: Transaction, turn: typeof turns.$inferSelect) {
	const summary = fallbackSummary(turn.roomSnapshot, turn.actionText, turn.outcome);
	const narration = fallbackProse(
		turn.roomSnapshot,
		turn.actionText,
		turn.outcome,
		Array.isArray(turn.rolls) ? turn.rolls : []
	);
	const finalized = await tx
		.update(turns)
		.set({
			narration,
			narrationStatus: 'complete',
			narrationStartedAt: null,
			narrationUpdatedAt: new Date(),
			turnSummary: summary
		})
		.where(
			and(
				eq(turns.id, turn.id),
				or(eq(turns.narrationStatus, 'pending'), eq(turns.narrationStatus, 'streaming'))
			)
		)
		.returning({ id: turns.id });
	if (finalized.length === 0) {
		// Another producer already finalized this turn. Reread the durable
		// narration and summary without overwriting run.summary.
		const [current] = await tx.select().from(turns).where(eq(turns.id, turn.id)).limit(1);
		if (!current) return { narration, summary };
		return {
			narration: current.narration || narration,
			summary: current.turnSummary || summary
		};
	}
	await tx
		.update(runs)
		.set({ summary })
		.where(and(eq(runs.id, turn.runId), eq(runs.version, turn.sequence)));
	return { narration, summary };
}

async function finalizeRoomFallback(
	tx: Transaction,
	entry: typeof roomEntries.$inferSelect,
	runSummary: string
) {
	await tx
		.update(roomEntries)
		.set({
			prose: fallbackRoomEntry(entry.roomSnapshot, runSummary),
			status: 'complete',
			startedAt: null,
			updatedAt: new Date()
		})
		.where(
			and(
				eq(roomEntries.id, entry.id),
				or(eq(roomEntries.status, 'pending'), eq(roomEntries.status, 'streaming'))
			)
		);
}

/** Minimal shapes so callers can pass full row types while tests use lightweight fixtures. */
interface PendingTurnCandidate {
	id: string;
	sequence: number;
	narrationStatus: NarrationStatus;
}
interface PendingRoomCandidate {
	id: string;
	status: NarrationStatus;
}

/**
 * Recovery targets for interrupted narrations, oldest turn first. Every recently
 * loaded owned turn that is still pending or streaming is included regardless of
 * phase or whether its legacy roomSnapshot carries roomNumber, so migrated runs
 * can finalize interrupted turns. The current room entry stays after the turns
 * when the run is ready and that entry is unresolved.
 */
export function _pendingNarrationTargets(
	recentTurns: PendingTurnCandidate[],
	currentEntry: PendingRoomCandidate | null,
	phase: RunPhase
): PendingNarration[] {
	const seen = new Set<string>();
	const targets: PendingNarration[] = [];
	for (const turn of recentTurns
		.filter((turn) => turn.narrationStatus === 'pending' || turn.narrationStatus === 'streaming')
		.sort((a, b) => a.sequence - b.sequence)) {
		if (seen.has(turn.id)) continue;
		seen.add(turn.id);
		targets.push({ kind: 'turn', id: turn.id });
	}
	if (
		phase === 'ready' &&
		currentEntry &&
		(currentEntry.status === 'pending' || currentEntry.status === 'streaming') &&
		!seen.has(currentEntry.id)
	) {
		targets.push({ kind: 'room', id: currentEntry.id });
	}
	return targets;
}

export const load: PageServerLoad = async (event) => {
	const user = requireUser(event);
	const parsedRunId = uuidSchema.safeParse(event.params.runId);
	if (!parsedRunId.success) throw error(404, 'Run not found');

	const owned = await ownedRun(parsedRunId.data, user.id);
	if (!owned) throw error(404, 'Run not found');
	const [account] = await db
		.select({ companyGold: users.companyGold })
		.from(users)
		.where(eq(users.id, user.id))
		.limit(1);

	const [recentTurns, recentEntries] = await Promise.all([
		db
			.select()
			.from(turns)
			.where(eq(turns.runId, owned.run.id))
			.orderBy(desc(turns.sequence))
			.limit(200),
		db
			.select()
			.from(roomEntries)
			.where(eq(roomEntries.runId, owned.run.id))
			.orderBy(desc(roomEntries.roomNumber))
			.limit(200)
	]);
	const currentEntry =
		recentEntries.find((entry) => entry.roomNumber === owned.run.roomNumber) ?? null;
	// The exact resolved turn is identified independently of phase or status so that
	// narration recovery can still reach it on defeated runs. After proceeding to a
	// new room, the changed room number naturally excludes the prior turn.
	const currentTurn =
		recentTurns.find(
			(turn) =>
				turn.sequence === owned.run.version && turn.roomSnapshot.roomNumber === owned.run.roomNumber
		) ?? null;

	const level =
		owned.run.meta.startLevel ?? owned.run.roomData.run?.startLevel ?? owned.character.level;
	const baseStats = resolveRunBaseStats(owned.run.meta, owned.character);
	const stats = deriveStats({
		body: baseStats.body,
		mind: baseStats.mind,
		spirit: baseStats.spirit,
		level,
		hp: owned.run.hp,
		maxHp: owned.run.maxHp,
		defense: 5 + level,
		attackBonus: baseStats.body + level,
		inventory: owned.run.inventory
	});
	const breakdowns = deriveStatBreakdowns({
		body: baseStats.body,
		mind: baseStats.mind,
		spirit: baseStats.spirit,
		level,
		hp: owned.run.hp,
		maxHp: owned.run.maxHp,
		defense: 5 + level,
		attackBonus: baseStats.body + level,
		inventory: owned.run.inventory
	});

	const suggestions: PlayView['suggestions'] = [];
	if (
		owned.run.status === 'active' &&
		owned.run.phase === 'ready' &&
		(currentEntry?.status === 'complete' || currentEntry?.status === 'failed')
	) {
		const endpoints = await db.select().from(llmEndpoints).where(eq(llmEndpoints.enabled, true));
		const generatedSuggestions = await suggestActions({
			system: systemPrompt(owned.run, owned.character),
			room: owned.run.roomData,
			endpoints
		});
		const candidates = [
			...generatedSuggestions,
			...fallbackSuggestions(owned.run.roomData),
			{
				label: 'Proceed carefully',
				detail: 'Rely on caution and close observation.',
				typed: 'I proceed carefully and watch for danger.'
			}
		];
		for (const candidate of candidates) {
			if (!candidate.typed.trim() || suggestions.some((item) => item.typed === candidate.typed))
				continue;
			suggestions.push(candidate);
			if (suggestions.length === 3) break;
		}
	}

	const data: PlayView = {
		runId: owned.run.id,
		status: owned.run.status,
		phase: owned.run.phase,
		room: {
			number: owned.run.roomNumber,
			title: owned.run.roomData.name ?? `The ${owned.run.roomType}`,
			kind: owned.run.roomType,
			prose:
				currentEntry?.prose ||
				owned.run.roomData.description ||
				'The dungeon waits in watchful silence.',
			exits: [],
			entryId: currentEntry?.id ?? null,
			entryStatus: currentEntry?.status ?? null
		},
		character: {
			name: owned.character.name,
			title: owned.character.title,
			className: owned.character.className,
			species: owned.character.species,
			level,
			age: owned.character.age,
			hp: owned.run.hp,
			maxHp: owned.run.maxHp,
			body: stats.body,
			mind: stats.mind,
			spirit: stats.spirit,
			defense: stats.defense,
			attackBonus: stats.attackBonus,
			skillValues: stats.skillValues,
			breakdowns,
			gold: Number(account?.companyGold ?? 0)
		},
		terminal: [
			...recentTurns.map((turn) => ({
				kind: 'turn' as const,
				id: turn.id,
				timestamp: turn.createdAt.toISOString(),
				turn: turn.sequence,
				action: turn.actionText,
				narration: turn.narration || turn.outcome.message,
				status: turn.narrationStatus,
				outcome: turn.outcome,
				rolls: Array.isArray(turn.rolls) ? turn.rolls : []
			})),
			...recentEntries.map((entry) => ({
				kind: 'room' as const,
				id: entry.id,
				timestamp: entry.createdAt.toISOString(),
				roomNumber: entry.roomNumber,
				title: entry.roomSnapshot.name ?? `The ${entry.roomSnapshot.type}`,
				roomKind: entry.roomSnapshot.type,
				prose: entry.prose || entry.roomSnapshot.description || 'The chamber waits in silence.',
				status: entry.status
			}))
		]
			.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
			.slice(-200),
		pendingNarrations: _pendingNarrationTargets(recentTurns, currentEntry, owned.run.phase),
		suggestions,
		expectedVersion: owned.run.version,
		actionKey: randomUUID(),
		actionKeys: Array.from({ length: suggestions.length + 1 }, () => randomUUID()),
		proceedKey: randomUUID(),
		awaitingTurn:
			owned.run.status === 'active' && owned.run.phase === 'awaiting_proceed' && currentTurn
				? {
						id: currentTurn.id,
						sequence: currentTurn.sequence,
						action: currentTurn.actionText,
						narration: currentTurn.narration || currentTurn.outcome.message,
						status: currentTurn.narrationStatus,
						outcome: currentTurn.outcome,
						rolls: Array.isArray(currentTurn.rolls) ? currentTurn.rolls : []
					}
				: null,
		inventory: owned.run.inventory,
		summary: owned.run.summary,
		characterName: owned.character.name,
		companyGold: Number(account?.companyGold ?? 0)
	};

	return data;
};

export const actions: Actions = {
	act: async (event) => {
		assertSameOrigin(event);
		const user = requireUser(event);
		const enhanced = event.request.headers.get('x-sveltekit-action') === 'true';
		const runId = uuidSchema.safeParse(event.params.runId);
		if (!runId.success) return fail(400, { error: 'Invalid run.' });

		const form = await event.request.formData();
		const rawAction = form.get('actionText');
		const actionText = typeof rawAction === 'string' ? rawAction.trim() : '';
		const expectedVersion = formInteger(form, 'expectedVersion');
		const actionKey = uuidSchema.safeParse(form.get('actionKey'));
		if (actionText.length < ACTION_MIN_LENGTH || actionText.length > ACTION_MAX_LENGTH) {
			return fail(400, { error: 'Action must be between 1 and 500 characters.' });
		}
		if (expectedVersion === null) return fail(400, { error: 'Invalid run version.' });
		if (!actionKey.success) return fail(400, { error: 'Invalid action key.' });

		const preflight = await ownedRun(runId.data, user.id);
		if (!preflight) return fail(404, { error: 'Run not found.' });
		if (preflight.run.status !== 'active') {
			return fail(409, { error: 'This run is already finished.' });
		}
		const mapped = enhanced
			? await (async () => {
					const endpoints = await db
						.select()
						.from(llmEndpoints)
						.where(eq(llmEndpoints.enabled, true));
					return interpretAction({
						system: systemPrompt(preflight.run, preflight.character),
						room: preflight.run.roomData,
						actionText,
						endpoints
					});
				})()
			: mapActionIntent({ text: actionText, room: preflight.run.roomData });
		const intent = toTurnIntent(normalizeActionIntent(preflight.run.roomData, mapped));

		type Resolution =
			| { kind: 'duplicate'; turnId: string; roomEntryId: string | null; version: number }
			| {
					kind: 'resolved';
					turnId: string;
					roomEntryId: string | null;
					version: number;
			  }
			| { kind: 'failure'; status: number; message: string };

		let resolution: Resolution;
		try {
			resolution = await db.transaction(async (tx): Promise<Resolution> => {
				const [run] = await tx
					.select()
					.from(runs)
					.where(and(eq(runs.id, runId.data), eq(runs.userId, user.id)))
					.limit(1)
					.for('update');
				if (!run) return { kind: 'failure', status: 404, message: 'Run not found.' };

				const [duplicate] = await tx
					.select()
					.from(turns)
					.where(and(eq(turns.runId, run.id), eq(turns.actionKey, actionKey.data)))
					.limit(1);
				if (duplicate) {
					if (duplicate.sequence !== expectedVersion + 1) {
						return {
							kind: 'failure',
							status: 409,
							message: 'This action key was already used for another turn.'
						};
					}
					if (!enhanced) {
						if (
							duplicate.narrationStatus === 'pending' ||
							duplicate.narrationStatus === 'streaming'
						) {
							await finalizeTurnFallback(tx, duplicate);
						}
					}
					return {
						kind: 'duplicate',
						turnId: duplicate.id,
						roomEntryId: null,
						version: duplicate.sequence
					};
				}
				if (run.status !== 'active') {
					return { kind: 'failure', status: 409, message: 'This run is already finished.' };
				}
				if (run.version !== expectedVersion) {
					return {
						kind: 'failure',
						status: 409,
						message: 'This action is stale. Reload the room and choose again.'
					};
				}
				if (run.phase !== 'ready') {
					return {
						kind: 'failure',
						status: 409,
						message: 'Proceed deeper before choosing another action.'
					};
				}
				const [entryState] = await tx
					.select()
					.from(roomEntries)
					.where(and(eq(roomEntries.runId, run.id), eq(roomEntries.roomNumber, run.roomNumber)))
					.limit(1)
					.for('update');
				if (!entryState) {
					return {
						kind: 'failure',
						status: 409,
						message: 'The current room record is missing. Reload and try again.'
					};
				}
				if (entryState.status !== 'complete' && entryState.status !== 'failed') {
					if (enhanced) {
						return {
							kind: 'failure',
							status: 409,
							message: 'Wait for the current room narration to finish before acting.'
						};
					}
					await tx
						.update(roomEntries)
						.set({
							prose: fallbackRoomEntry(entryState.roomSnapshot, ''),
							status: 'complete',
							startedAt: null,
							updatedAt: new Date()
						})
						.where(eq(roomEntries.id, entryState.id));
				}

				const [character] = await tx
					.select()
					.from(characters)
					.where(and(eq(characters.id, run.characterId), eq(characters.userId, user.id)))
					.limit(1)
					.for('update');
				if (!character) {
					return { kind: 'failure', status: 404, message: 'Hero not found.' };
				}
				// Gameplay lock order: run, owned character, then user.
				const [account] = await tx
					.select()
					.from(users)
					.where(eq(users.id, user.id))
					.limit(1)
					.for('update');
				if (!account) return { kind: 'failure', status: 404, message: 'Company not found.' };

				const sequence = run.version + 1;
				const roomSnapshot = { ...structuredClone(run.roomData), roomNumber: run.roomNumber };
				const level = run.meta.startLevel ?? run.roomData.run?.startLevel ?? character.level;
				const baseStats = resolveRunBaseStats(run.meta, character);
				const stats = deriveStats({
					body: baseStats.body,
					mind: baseStats.mind,
					spirit: baseStats.spirit,
					level,
					hp: run.hp,
					maxHp: run.maxHp,
					defense: 5 + level,
					attackBonus: baseStats.body + level,
					inventory: run.inventory
				});
				const encounter = resolveEncounter({
					seed: run.seed,
					roomNumber: run.roomNumber,
					turn: sequence,
					room: structuredClone(roomSnapshot),
					intent,
					stats,
					hp: run.hp,
					maxHp: run.maxHp
				});
				const fallbackTurnSummary = fallbackSummary(roomSnapshot, actionText, encounter.outcome);
				const [turn] = await tx
					.insert(turns)
					.values({
						runId: run.id,
						sequence,
						actionKey: actionKey.data,
						actionText,
						intent,
						roomSnapshot,
						rolls: encounter.rolls,
						outcome: encounter.outcome,
						narration: enhanced
							? ''
							: fallbackProse(roomSnapshot, actionText, encounter.outcome, encounter.rolls),
						narrationStatus: enhanced ? 'pending' : 'complete',
						narrationUpdatedAt: enhanced ? null : new Date(),
						turnSummary: fallbackTurnSummary
					})
					.returning({ id: turns.id });

				const inventory = [...run.inventory, ...(encounter.outcome.rewards ?? [])];
				if (encounter.outcome.hpAfter <= 0) {
					const completedRun = { ...run, inventory, version: sequence };
					const gold = settlementGold(
						completedRun.inventory,
						completedRun.seed,
						completedRun.roomNumber,
						completedRun.version
					);
					await tx
						.update(characters)
						.set({
							furthestFloor: sql`greatest(${characters.furthestFloor}, ${run.roomNumber})`,
							updatedAt: new Date()
						})
						.where(and(eq(characters.id, character.id), eq(characters.userId, user.id)));
					const companyGold = checkedCompanyGoldAdd(account.companyGold, gold);
					await tx
						.update(users)
						.set({ companyGold, updatedAt: new Date() })
						.where(eq(users.id, user.id));
					await tx
						.update(runs)
						.set({
							status: 'defeated',
							finishedAt: new Date(),
							hp: 0,
							inventory: [],
							version: sequence,
							summary: fallbackTurnSummary
						})
						.where(and(eq(runs.id, run.id), eq(runs.userId, user.id)));
					await award(tx, user.id, {
						firstDefeat: true,
						roomNumber: run.roomNumber,
						gold: companyGold
					});
				} else {
					await tx
						.update(runs)
						.set({
							hp: encounter.outcome.hpAfter,
							inventory,
							version: sequence,
							phase: 'awaiting_proceed',
							summary: fallbackTurnSummary
						})
						.where(and(eq(runs.id, run.id), eq(runs.userId, user.id)));
				}

				return {
					kind: 'resolved',
					turnId: turn.id,
					roomEntryId: null,
					version: sequence
				};
			});
		} catch {
			return fail(500, { error: 'The action could not be resolved. Please try again.' });
		}

		if (resolution.kind === 'failure') {
			return fail(resolution.status, { error: resolution.message });
		}
		if (!enhanced) throw redirect(303, `/play/${runId.data}`);
		return {
			success: true,
			turnId: resolution.turnId,
			roomEntryId: resolution.roomEntryId,
			version: resolution.version
		};
	},

	proceed: async (event) => {
		assertSameOrigin(event);
		const user = requireUser(event);
		const enhanced = event.request.headers.get('x-sveltekit-action') === 'true';
		const runId = uuidSchema.safeParse(event.params.runId);
		if (!runId.success) return fail(400, { error: 'Invalid run.' });
		const form = await event.request.formData();
		const expectedVersion = formInteger(form, 'expectedVersion');
		const commandKey = uuidSchema.safeParse(form.get('commandKey'));
		if (expectedVersion === null) return fail(400, { error: 'Invalid run version.' });
		if (!commandKey.success) return fail(400, { error: 'Invalid proceed key.' });

		const preflight = await ownedRun(runId.data, user.id);
		if (!preflight) return fail(404, { error: 'Run not found.' });
		const [monsterRows, trapRows] = await Promise.all([
			db.select().from(monsters).where(eq(monsters.enabled, true)),
			db.select().from(traps).where(eq(traps.enabled, true))
		]);

		type ProceedResult =
			| { kind: 'proceeded' | 'duplicate'; roomEntryId: string; version: number }
			| { kind: 'failure'; status: number; message: string };
		let result: ProceedResult;
		try {
			result = await db.transaction(async (tx): Promise<ProceedResult> => {
				const [run] = await tx
					.select()
					.from(runs)
					.where(and(eq(runs.id, runId.data), eq(runs.userId, user.id)))
					.limit(1)
					.for('update');
				if (!run) return { kind: 'failure', status: 404, message: 'Run not found.' };

				const [duplicate] = await tx
					.select()
					.from(roomEntries)
					.where(and(eq(roomEntries.runId, run.id), eq(roomEntries.commandKey, commandKey.data)))
					.limit(1);
				if (duplicate) {
					if (duplicate.runVersion !== expectedVersion) {
						return {
							kind: 'failure',
							status: 409,
							message: 'This proceed key was already used for another turn.'
						};
					}
					if (!enhanced) {
						const [turn] = await tx
							.select()
							.from(turns)
							.where(and(eq(turns.runId, run.id), eq(turns.sequence, expectedVersion)))
							.limit(1);
						let summary = run.summary;
						if (
							turn &&
							(turn.narrationStatus === 'pending' || turn.narrationStatus === 'streaming')
						) {
							summary = (await finalizeTurnFallback(tx, turn)).summary;
						}
						if (duplicate.status === 'pending' || duplicate.status === 'streaming') {
							await finalizeRoomFallback(tx, duplicate, summary);
						}
					}
					return {
						kind: 'duplicate',
						roomEntryId: duplicate.id,
						version: duplicate.runVersion
					};
				}

				if (run.status !== 'active') {
					return { kind: 'failure', status: 409, message: 'This run is already finished.' };
				}
				if (run.version !== expectedVersion) {
					return {
						kind: 'failure',
						status: 409,
						message: 'This proceed command is stale. Reload the room and try again.'
					};
				}
				if (run.phase !== 'awaiting_proceed') {
					return {
						kind: 'failure',
						status: 409,
						message: 'This expedition is not waiting to proceed.'
					};
				}

				const [turn] = await tx
					.select()
					.from(turns)
					.where(and(eq(turns.runId, run.id), eq(turns.sequence, run.version)))
					.limit(1);
				if (!turn || turn.roomSnapshot.roomNumber !== run.roomNumber) {
					return {
						kind: 'failure',
						status: 409,
						message: 'The resolved turn does not match this room. Reload and try again.'
					};
				}
				let summary = turn.turnSummary || run.summary;
				if (turn.narrationStatus !== 'complete' && turn.narrationStatus !== 'failed') {
					if (enhanced) {
						return {
							kind: 'failure',
							status: 409,
							message: 'Wait for the action narration to finish before proceeding.'
						};
					}
					summary = (await finalizeTurnFallback(tx, turn)).summary;
				}

				const [character] = await tx
					.select()
					.from(characters)
					.where(and(eq(characters.id, run.characterId), eq(characters.userId, user.id)))
					.limit(1)
					.for('update');
				if (!character) return { kind: 'failure', status: 404, message: 'Hero not found.' };
				const [account] = await tx
					.select()
					.from(users)
					.where(eq(users.id, user.id))
					.limit(1)
					.for('update');
				if (!account) return { kind: 'failure', status: 404, message: 'Company not found.' };

				const nextNumber = run.roomNumber + 1;
				const generated = generateRoom({
					seed: run.seed,
					room: nextNumber,
					turn: run.version,
					debauchery: run.debauchery,
					monsters: monsterRows,
					traps: trapRows
				});
				const nextRoom = {
					...generated,
					roomNumber: nextNumber,
					...(run.roomData.run ? { run: run.roomData.run } : {})
				};
				await tx
					.update(runs)
					.set({
						roomNumber: nextNumber,
						roomType: generated.type,
						roomData: nextRoom,
						phase: 'ready',
						summary
					})
					.where(and(eq(runs.id, run.id), eq(runs.userId, user.id)));
				const [entry] = await tx
					.insert(roomEntries)
					.values({
						runId: run.id,
						commandKey: commandKey.data,
						roomNumber: nextNumber,
						runVersion: run.version,
						roomSnapshot: nextRoom,
						prose: enhanced ? '' : fallbackRoomEntry(nextRoom, summary),
						status: enhanced ? 'pending' : 'complete',
						updatedAt: enhanced ? null : new Date()
					})
					.returning({ id: roomEntries.id });
				await tx
					.update(characters)
					.set({
						furthestFloor: sql`greatest(${characters.furthestFloor}, ${nextNumber})`,
						updatedAt: new Date()
					})
					.where(and(eq(characters.id, character.id), eq(characters.userId, user.id)));
				await award(tx, user.id, {
					firstDefeat: false,
					roomNumber: nextNumber,
					gold: account.companyGold
				});
				return { kind: 'proceeded', roomEntryId: entry.id, version: run.version };
			});
		} catch {
			return fail(500, { error: 'The next room could not be generated. Please try again.' });
		}
		if (result.kind === 'failure') return fail(result.status, { error: result.message });
		if (!enhanced) throw redirect(303, `/play/${runId.data}`);
		return {
			success: true,
			turnId: null,
			roomEntryId: result.roomEntryId,
			version: result.version
		};
	},

	abandon: async (event) => {
		assertSameOrigin(event);
		const user = requireUser(event);
		const runId = uuidSchema.safeParse(event.params.runId);
		if (!runId.success) return fail(400, { error: 'Invalid run.' });

		try {
			const result = await db.transaction(async (tx) => {
				const [run] = await tx
					.select()
					.from(runs)
					.where(and(eq(runs.id, runId.data), eq(runs.userId, user.id)))
					.limit(1)
					.for('update');
				if (!run) return { status: 404, message: 'Run not found.' };
				if (run.status !== 'active') return null;

				const [character] = await tx
					.select()
					.from(characters)
					.where(and(eq(characters.id, run.characterId), eq(characters.userId, user.id)))
					.limit(1)
					.for('update');
				if (!character) return { status: 404, message: 'Hero not found.' };
				const [account] = await tx
					.select()
					.from(users)
					.where(eq(users.id, user.id))
					.limit(1)
					.for('update');
				if (!account) return { status: 404, message: 'Company not found.' };

				const gold = settlementGold(run.inventory, run.seed, run.roomNumber, run.version);
				await tx
					.update(characters)
					.set({
						furthestFloor: sql`greatest(${characters.furthestFloor}, ${run.roomNumber})`,
						updatedAt: new Date()
					})
					.where(and(eq(characters.id, character.id), eq(characters.userId, user.id)));
				const companyGold = checkedCompanyGoldAdd(account.companyGold, gold);
				await tx
					.update(users)
					.set({ companyGold, updatedAt: new Date() })
					.where(eq(users.id, user.id));
				await tx
					.update(runs)
					.set({ status: 'abandoned', finishedAt: new Date(), inventory: [] })
					.where(and(eq(runs.id, run.id), eq(runs.userId, user.id)));
				await award(tx, user.id, {
					firstDefeat: false,
					roomNumber: run.roomNumber,
					gold: companyGold
				});
				return null;
			});
			if (result) return fail(result.status, { error: result.message });
		} catch {
			return fail(500, { error: 'The run could not be abandoned. Please try again.' });
		}
		throw redirect(303, `/play/${runId.data}`);
	}
};
