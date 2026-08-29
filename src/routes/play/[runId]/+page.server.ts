import { randomUUID } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { PlayView, RoomSnapshot, TurnOutcome } from '$lib/types';
import { achievementByKey, eligibleKeys } from '$lib/server/achievements';
import { requireUser } from '$lib/server/authorization';
import { assertSameOrigin } from '$lib/server/csrf';
import { db } from '$lib/server/db';
import {
	deriveStats,
	generateRoom,
	normalizeActionIntent,
	resolveEncounter,
	sellValue,
	toTurnIntent
} from '$lib/server/game';
import {
	fallbackProse,
	fallbackSuggestions,
	fallbackSummary,
	interpretAction,
	narrateProse,
	suggestActions,
	summarizeTurn
} from '$lib/server/llm';
import { buildSystemPrompt } from '$lib/server/prompts';
import { createRng } from '$lib/server/rng';
import {
	achievements,
	characters,
	llmEndpoints,
	monsters,
	runs,
	traps,
	turns,
	userAchievements
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
		// Stored charter sliders are 1..5; prompt directives are indexed 0..4.
		brutality: run.brutality - 1,
		debauchery: run.debauchery - 1,
		adventurer: {
			name: character.name,
			title: character.title,
			species: character.species,
			className: character.className,
			level: run.roomData.run?.startLevel ?? character.level
		}
	});
}

function settlementGold(run: typeof runs.$inferSelect): number {
	const rng = createRng(run.seed, run.roomNumber, run.version, 'settlement');
	return run.inventory.reduce((total, item) => total + sellValue(item, rng), 0);
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

export const load: PageServerLoad = async (event) => {
	const user = requireUser(event);
	const parsedRunId = uuidSchema.safeParse(event.params.runId);
	if (!parsedRunId.success) throw error(404, 'Run not found');

	const owned = await ownedRun(parsedRunId.data, user.id);
	if (!owned) throw error(404, 'Run not found');

	const turnRows = await db
		.select()
		.from(turns)
		.where(eq(turns.runId, owned.run.id))
		.orderBy(asc(turns.sequence));

	const level = owned.run.roomData.run?.startLevel ?? owned.character.level;
	const stats = deriveStats({
		body: owned.character.body,
		mind: owned.character.mind,
		spirit: owned.character.spirit,
		level,
		hp: owned.run.hp,
		maxHp: owned.run.maxHp,
		defense: 5 + level,
		attackBonus: owned.character.body + level,
		inventory: owned.run.inventory
	});

	const suggestions: PlayView['suggestions'] = [];
	if (owned.run.status === 'active') {
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
		room: {
			number: owned.run.roomNumber,
			title: owned.run.roomData.name ?? `The ${owned.run.roomType}`,
			kind: owned.run.roomType,
			prose: owned.run.roomData.description ?? 'The dungeon waits in watchful silence.',
			exits: []
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
			gold: owned.character.persistentGold
		},
		turns: turnRows.map((turn) => ({
			id: turn.id,
			turn: turn.sequence,
			actor: 'adventurer',
			action: turn.actionText,
			narration: turn.narration || turn.turnSummary || turn.outcome.message,
			roll: turn.rolls[0]
		})),
		suggestions,
		expectedVersion: owned.run.version,
		actionKey: randomUUID(),
		actionKeys: Array.from({ length: suggestions.length + 1 }, () => randomUUID()),
		inventory: owned.run.inventory,
		summary: owned.run.summary,
		characterName: owned.character.name
	};

	return data;
};

export const actions: Actions = {
	act: async (event) => {
		assertSameOrigin(event);
		const user = requireUser(event);
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
		if (preflight.run.debauchery > 1 && preflight.character.age < 18) {
			return fail(400, { error: 'Adult content requires a hero aged 18 or older.' });
		}

		const endpoints = await db.select().from(llmEndpoints).where(eq(llmEndpoints.enabled, true));
		const prompt = systemPrompt(preflight.run, preflight.character);
		const mapped = await interpretAction({
			system: prompt,
			room: preflight.run.roomData,
			actionText,
			endpoints
		});
		const intent = toTurnIntent(normalizeActionIntent(preflight.run.roomData, mapped));

		type Resolution =
			| { kind: 'duplicate' }
			| {
					kind: 'resolved';
					turnId: string;
					version: number;
					room: RoomSnapshot;
					outcome: TurnOutcome;
					prompt: string;
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
					.select({ id: turns.id })
					.from(turns)
					.where(and(eq(turns.runId, run.id), eq(turns.actionKey, actionKey.data)))
					.limit(1);
				if (duplicate) return { kind: 'duplicate' };
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

				const [character] = await tx
					.select()
					.from(characters)
					.where(and(eq(characters.id, run.characterId), eq(characters.userId, user.id)))
					.limit(1)
					.for('update');
				if (!character) {
					return { kind: 'failure', status: 404, message: 'Hero not found.' };
				}
				if (run.debauchery > 1 && character.age < 18) {
					return {
						kind: 'failure',
						status: 400,
						message: 'Adult content requires a hero aged 18 or older.'
					};
				}

				const sequence = run.version + 1;
				const roomSnapshot = structuredClone(run.roomData);
				const level = run.roomData.run?.startLevel ?? character.level;
				const stats = deriveStats({
					body: character.body,
					mind: character.mind,
					spirit: character.spirit,
					level,
					hp: run.hp,
					maxHp: run.maxHp,
					defense: 5 + level,
					attackBonus: character.body + level,
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
				const fallbackNarration = fallbackProse(roomSnapshot, actionText, encounter.outcome);
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
						narration: fallbackNarration,
						turnSummary: fallbackTurnSummary
					})
					.returning({ id: turns.id });

				const inventory = [...run.inventory, ...(encounter.outcome.rewards ?? [])];
				if (encounter.outcome.hpAfter <= 0) {
					const completedRun = { ...run, inventory, version: sequence };
					const gold = settlementGold(completedRun);
					const [updatedCharacter] = await tx
						.update(characters)
						.set({
							persistentGold: sql`${characters.persistentGold} + ${gold}`,
							furthestFloor: sql`greatest(${characters.furthestFloor}, ${run.roomNumber})`,
							updatedAt: new Date()
						})
						.where(and(eq(characters.id, character.id), eq(characters.userId, user.id)))
						.returning({ gold: characters.persistentGold });
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
						gold: updatedCharacter.gold
					});
				} else {
					const [monsterRows, trapRows] = await Promise.all([
						tx.select().from(monsters).where(eq(monsters.enabled, true)),
						tx.select().from(traps).where(eq(traps.enabled, true))
					]);
					const nextNumber = run.roomNumber + 1;
					const generated = generateRoom({
						seed: run.seed,
						room: nextNumber,
						turn: sequence,
						debauchery: run.debauchery,
						monsters: monsterRows,
						traps: trapRows
					});
					const nextRoom = {
						...generated,
						...(run.roomData.run ? { run: run.roomData.run } : {})
					};
					await tx
						.update(runs)
						.set({
							hp: encounter.outcome.hpAfter,
							inventory,
							version: sequence,
							roomNumber: nextNumber,
							roomType: generated.type,
							roomData: nextRoom,
							summary: fallbackTurnSummary
						})
						.where(and(eq(runs.id, run.id), eq(runs.userId, user.id)));
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
						gold: character.persistentGold
					});
				}

				return {
					kind: 'resolved',
					turnId: turn.id,
					version: sequence,
					room: roomSnapshot,
					outcome: encounter.outcome,
					prompt: systemPrompt(run, character)
				};
			});
		} catch {
			return fail(500, { error: 'The action could not be resolved. Please try again.' });
		}

		if (resolution.kind === 'failure') {
			return fail(resolution.status, { error: resolution.message });
		}
		if (resolution.kind === 'resolved') {
			const [narration, summary] = await Promise.all([
				narrateProse({
					system: resolution.prompt,
					room: resolution.room,
					actionText,
					outcome: resolution.outcome,
					endpoints
				}),
				summarizeTurn({
					system: resolution.prompt,
					room: resolution.room,
					actionText,
					outcome: resolution.outcome,
					endpoints
				})
			]);
			await Promise.all([
				db
					.update(turns)
					.set({ narration, turnSummary: summary })
					.where(and(eq(turns.id, resolution.turnId), eq(turns.runId, runId.data))),
				db
					.update(runs)
					.set({ summary })
					.where(
						and(
							eq(runs.id, runId.data),
							eq(runs.userId, user.id),
							eq(runs.version, resolution.version)
						)
					)
			]);
		}
		throw redirect(303, `/play/${runId.data}`);
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

				const gold = settlementGold(run);
				const [updatedCharacter] = await tx
					.update(characters)
					.set({
						persistentGold: sql`${characters.persistentGold} + ${gold}`,
						furthestFloor: sql`greatest(${characters.furthestFloor}, ${run.roomNumber})`,
						updatedAt: new Date()
					})
					.where(and(eq(characters.id, character.id), eq(characters.userId, user.id)))
					.returning({ gold: characters.persistentGold });
				await tx
					.update(runs)
					.set({ status: 'abandoned', finishedAt: new Date(), inventory: [] })
					.where(and(eq(runs.id, run.id), eq(runs.userId, user.id)));
				await award(tx, user.id, {
					firstDefeat: false,
					roomNumber: run.roomNumber,
					gold: updatedCharacter.gold
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
