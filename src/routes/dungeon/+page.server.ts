import { and, eq, isNull, sql } from 'drizzle-orm';
import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { achievementByKey } from '$lib/server/achievements';
import { requireUser } from '$lib/server/authorization';
import { randomUrlToken } from '$lib/server/crypto';
import { assertSameOrigin } from '$lib/server/csrf';
import { db } from '$lib/server/db';
import { generateRoom, provisionPersistentGear } from '$lib/server/game';
import {
	achievements,
	characters,
	monsters,
	roomEntries,
	runs,
	traps,
	userAchievements,
	users
} from '$lib/server/schema';
import type { RunMeta } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

const uuidSchema = z.string().uuid();
const integer = (form: FormData, name: string) => {
	const value = form.get(name);
	if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) ? parsed : null;
};

export const load: PageServerLoad = async (event) => {
	const user = requireUser(event);
	const [characterRows, activeRuns, [account]] = await Promise.all([
		db
			.select()
			.from(characters)
			.where(and(eq(characters.userId, user.id), isNull(characters.retiredAt)))
			.orderBy(characters.name),
		db
			.select({ id: runs.id, characterId: runs.characterId, roomNumber: runs.roomNumber })
			.from(runs)
			.where(and(eq(runs.userId, user.id), eq(runs.status, 'active'))),
		db
			.select({
				companyGold: users.companyGold,
				brutality: users.brutality,
				debauchery: users.debauchery
			})
			.from(users)
			.where(eq(users.id, user.id))
			.limit(1)
	]);
	const active = new Map(activeRuns.map((run) => [run.characterId, run]));
	const requested = uuidSchema.safeParse(event.url.searchParams.get('character'));
	const selectedCharacterId =
		requested.success && characterRows.some((character) => character.id === requested.data)
			? requested.data
			: (characterRows.find((character) => !active.has(character.id))?.id ??
				characterRows[0]?.id ??
				null);
	return {
		characters: characterRows.map((character) => ({
			id: character.id,
			name: character.name,
			level: character.level,
			body: character.body,
			mind: character.mind,
			spirit: character.spirit,
			gearBonus: character.gearBonus,
			maxStartRoom: character.maxStartRoom,
			activeRun: active.get(character.id) ?? null
		})),
		selectedCharacterId,
		companyGold: Number(account?.companyGold ?? 0),
		settings: { brutality: account?.brutality ?? 3, debauchery: account?.debauchery ?? 3 }
	};
};

export const actions: Actions = {
	start: async (event) => {
		assertSameOrigin(event);
		const user = requireUser(event);
		const form = await event.request.formData();
		const characterId = uuidSchema.safeParse(form.get('characterId'));
		const startRoom = integer(form, 'startRoom');
		if (!characterId.success || startRoom === null || startRoom < 1)
			return fail(400, { error: 'Choose a character and a valid starting room.' });
		// Definition reads and random seed generation happen before the transaction; no network occurs inside it.
		const [monsterRows, trapRows] = await Promise.all([
			db.select().from(monsters).where(eq(monsters.enabled, true)),
			db.select().from(traps).where(eq(traps.enabled, true))
		]);
		const seed = randomUrlToken(32);
		type Result = { runId: string } | { error: string; status: number };
		try {
			const result = await db.transaction(async (tx): Promise<Result> => {
				// Start lock order: owned character, then user.
				const [character] = await tx
					.select()
					.from(characters)
					.where(and(eq(characters.id, characterId.data), eq(characters.userId, user.id)))
					.limit(1)
					.for('update');
				if (!character) return { error: 'Character not found.', status: 404 };
				if (character.retiredAt)
					return { error: 'Retired characters cannot begin a new expedition.', status: 409 };
				if (startRoom > character.maxStartRoom)
					return {
						error: `This character can start no deeper than room ${character.maxStartRoom}.`,
						status: 400
					};
				const [active] = await tx
					.select({ id: runs.id })
					.from(runs)
					.where(and(eq(runs.characterId, character.id), eq(runs.status, 'active')))
					.limit(1);
				if (active)
					return { error: 'This character already has an active expedition.', status: 409 };
				const [account] = await tx
					.select()
					.from(users)
					.where(eq(users.id, user.id))
					.limit(1)
					.for('update');
				if (!account) return { error: 'Company not found.', status: 404 };
				const meta: RunMeta = {
					startRoom,
					startLevel: character.level,
					gearBonus: character.gearBonus,
					allocatedBody: character.body,
					allocatedMind: character.mind,
					allocatedSpirit: character.spirit
				};
				const generated = generateRoom({
					seed,
					room: startRoom,
					turn: 0,
					debauchery: account.debauchery,
					monsters: monsterRows,
					traps: trapRows
				});
				const roomData = { ...generated, roomNumber: startRoom, run: meta };
				const maxHp = 5 + character.body;
				const [run] = await tx
					.insert(runs)
					.values({
						userId: user.id,
						characterId: character.id,
						status: 'active',
						phase: 'ready',
						seed,
						rulesVersion: 2,
						roomNumber: startRoom,
						version: 0,
						hp: maxHp,
						maxHp,
						brutality: account.brutality,
						debauchery: account.debauchery,
						roomType: generated.type,
						roomData,
						meta,
						inventory: provisionPersistentGear(character.gearBonus)
					})
					.returning({ id: runs.id });
				await tx.insert(roomEntries).values({
					runId: run.id,
					roomNumber: startRoom,
					runVersion: 0,
					roomSnapshot: roomData,
					status: 'pending'
				});
				await tx
					.update(characters)
					.set({
						furthestFloor: sql`greatest(${characters.furthestFloor}, ${startRoom})`,
						updatedAt: new Date()
					})
					.where(and(eq(characters.id, character.id), eq(characters.userId, user.id)));
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
		} catch (cause) {
			if (cause && typeof cause === 'object' && 'status' in cause && 'location' in cause)
				throw cause;
			return fail(500, { error: 'The expedition could not be started.' });
		}
	}
};
