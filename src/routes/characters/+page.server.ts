import { and, eq, sql } from 'drizzle-orm';
import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { InventoryItem, CharacterCard, RunMeta } from '$lib/types';
import { achievementByKey } from '$lib/server/achievements';
import { requireUser } from '$lib/server/authorization';
import { randomUrlToken } from '$lib/server/crypto';
import { assertSameOrigin } from '$lib/server/csrf';
import { db } from '$lib/server/db';
import { generateRoom, validateStatAllocation } from '$lib/server/game';
import {
	achievements,
	characters,
	monsters,
	roomEntries,
	runs,
	traps,
	userAchievements
} from '$lib/server/schema';
import type { Actions, PageServerLoad } from './$types';

const GEAR_COSTS = [0, 25, 75, 225] as const;
const uuidSchema = z.string().uuid();
type RunStartResult = { runId: string } | { error: string; status: number };

function formInteger(form: FormData, name: string): number | null {
	const raw = form.get(name);
	if (typeof raw !== 'string' || !/^-?\d+$/.test(raw)) return null;
	const value = Number(raw);
	return Number.isSafeInteger(value) ? value : null;
}

function provisionedGear(gear: number): InventoryItem[] {
	return Array.from({ length: gear }, (_, index) => ({
		kind: 'magic' as const,
		name: `Provisioned gear +${index + 1}`,
		description: 'Expedition gear that bolsters every primary nature while carried.',
		stat: 'general' as const
	}));
}

export const load: PageServerLoad = async (event) => {
	const user = requireUser(event);
	const characterRows = await db.select().from(characters).where(eq(characters.userId, user.id));
	const activeRows = await db
		.select({ id: runs.id, characterId: runs.characterId })
		.from(runs)
		.where(and(eq(runs.userId, user.id), eq(runs.status, 'active')));
	const activeRunByCharacter = new Map(activeRows.map((run) => [run.characterId, run.id]));

	const characterCards: CharacterCard[] = characterRows.map((character) => ({
		id: character.id,
		name: character.name,
		title: character.title,
		species: character.species,
		className: character.className,
		level: character.level,
		body: character.body,
		mind: character.mind,
		spirit: character.spirit,
		gold: character.persistentGold,
		furthestDepth: character.furthestFloor,
		activeRunId: activeRunByCharacter.get(character.id)
	}));

	return { characters: characterCards, companyName: user.companyName || 'The Endless Company' };
};

export const actions: Actions = {
	start: async (event) => {
		assertSameOrigin(event);
		const user = requireUser(event);
		const form = await event.request.formData();
		const characterId = uuidSchema.safeParse(form.get('characterId'));
		const brutality = formInteger(form, 'brutality');
		const debauchery = formInteger(form, 'debauchery');
		const startRoom = formInteger(form, 'startRoom');
		const level = formInteger(form, 'level');
		const gear = formInteger(form, 'gear');
		const allocatedBody = formInteger(form, 'body');
		const allocatedMind = formInteger(form, 'mind');
		const allocatedSpirit = formInteger(form, 'spirit');

		if (!characterId.success) {
			return fail(400, { error: 'Choose a hero before starting a run.' });
		}
		if (brutality === null || brutality < 1 || brutality > 5) {
			return fail(400, { error: 'Brutality must be between 1 and 5.' });
		}
		if (debauchery === null || debauchery < 1 || debauchery > 5) {
			return fail(400, { error: 'Debauchery must be between 1 and 5.' });
		}
		if (startRoom === null || startRoom < 1) {
			return fail(400, { error: 'Starting room must be a whole number of 1 or greater.' });
		}
		if (level === null || level < 1 || level > 10) {
			return fail(400, { error: 'Run level must be between 1 and 10.' });
		}
		if (gear === null || gear < 0 || gear > 3) {
			return fail(400, { error: 'Provisioned gear must be between 0 and 3.' });
		}
		if (
			level === null ||
			allocatedBody === null ||
			allocatedMind === null ||
			allocatedSpirit === null ||
			!validateStatAllocation(level, allocatedBody, allocatedMind, allocatedSpirit)
		) {
			return fail(400, {
				error:
					'Allocate exactly one point per run level. Stats are capped at 3, except level 10 permits one stat at 4.'
			});
		}

		const skipCost = 5 * (startRoom - 1);
		const levelCost = level === 1 ? 0 : 20 + (level - 2) * 10;
		const totalCost = skipCost + levelCost + GEAR_COSTS[gear];

		try {
			const result: RunStartResult = await db.transaction(async (tx): Promise<RunStartResult> => {
				const [character] = await tx
					.select()
					.from(characters)
					.where(and(eq(characters.id, characterId.data), eq(characters.userId, user.id)))
					.limit(1)
					.for('update');

				if (!character) {
					return { error: 'That hero does not exist or does not belong to you.', status: 404 };
				}
				if (debauchery > 1 && character.age < 18) {
					return { error: 'Debauchery above 1 requires a hero aged 18 or older.', status: 400 };
				}

				const [activeRun] = await tx
					.select({ id: runs.id })
					.from(runs)
					.where(
						and(
							eq(runs.characterId, character.id),
							eq(runs.userId, user.id),
							eq(runs.status, 'active')
						)
					)
					.limit(1);
				if (activeRun) return { error: 'This hero already has an active run.', status: 409 };
				if (character.persistentGold < totalCost) {
					return {
						error: `This charter costs ${totalCost} gold, but the hero has ${character.persistentGold}.`,
						status: 400
					};
				}

				const [monsterRows, trapRows] = await Promise.all([
					tx.select().from(monsters).where(eq(monsters.enabled, true)),
					tx.select().from(traps).where(eq(traps.enabled, true))
				]);
				const seed = randomUrlToken(32);
				const room = generateRoom({
					seed,
					room: startRoom,
					turn: 0,
					debauchery,
					monsters: monsterRows,
					traps: trapRows
				});
				const meta: RunMeta = {
					startRoom,
					startLevel: level,
					gearBonus: gear,
					allocatedBody,
					allocatedMind,
					allocatedSpirit
				};
				const roomData = {
					...room,
					run: meta
				};
				const maxHp = 5 + allocatedBody;

				await tx
					.update(characters)
					.set({
						persistentGold: character.persistentGold - totalCost,
						furthestFloor: sql`greatest(${characters.furthestFloor}, ${startRoom})`,
						updatedAt: new Date()
					})
					.where(and(eq(characters.id, character.id), eq(characters.userId, user.id)));

				const [run] = await tx
					.insert(runs)
					.values({
						userId: user.id,
						characterId: character.id,
						status: 'active',
						seed,
						rulesVersion: 1,
						roomNumber: startRoom,
						version: 0,
						hp: maxHp,
						maxHp,
						brutality,
						debauchery,
						roomType: room.type,
						roomData,
						meta,
						inventory: provisionedGear(gear)
					})
					.returning({ id: runs.id });

				await tx.insert(roomEntries).values({
					runId: run.id,
					roomNumber: startRoom,
					runVersion: 0,
					roomSnapshot: roomData,
					status: 'pending'
				});

				for (const key of startRoom >= 10 ? ['first-entry', 'double-digits'] : ['first-entry']) {
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
						.values({ userId: user.id, achievementId: achievement.id })
						.onConflictDoNothing();
				}

				return { runId: run.id };
			});

			if ('error' in result) return fail(result.status, { error: result.error });
			throw redirect(303, `/play/${result.runId}`);
		} catch (error) {
			if (error && typeof error === 'object' && 'status' in error && 'location' in error)
				throw error;
			console.error('Unable to start run:', error);
			return fail(500, { error: 'The run could not be started. Please try again.' });
		}
	}
};
