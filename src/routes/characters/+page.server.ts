import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import type { CharacterCard } from '$lib/types';
import { requireUser } from '$lib/server/authorization';
import { assertSameOrigin } from '$lib/server/csrf';
import { db } from '$lib/server/db';
import {
	canIncreaseStat,
	deriveStatBreakdowns,
	deriveStats,
	gearUpgradeCost,
	levelUpgradeCost,
	type PrimaryStat
} from '$lib/server/game';
import { characters, runs, users } from '$lib/server/schema';
import type { Actions, PageServerLoad } from './$types';

const uuidSchema = z.string().uuid();
const statSchema = z.enum(['body', 'mind', 'spirit']);
type UpgradeKind = 'level' | 'gear' | 'room';

export const load: PageServerLoad = async (event) => {
	const user = requireUser(event);
	const [characterRows, activeRows, [account]] = await Promise.all([
		db
			.select()
			.from(characters)
			.where(and(eq(characters.userId, user.id), isNull(characters.retiredAt)))
			.orderBy(characters.createdAt),
		db
			.select({ id: runs.id, characterId: runs.characterId })
			.from(runs)
			.where(and(eq(runs.userId, user.id), eq(runs.status, 'active'))),
		db.select({ companyGold: users.companyGold }).from(users).where(eq(users.id, user.id)).limit(1)
	]);
	const activeRunByCharacter = new Map(activeRows.map((run) => [run.characterId, run.id]));
	const cards: CharacterCard[] = characterRows.map((character) => {
		const input = {
			body: character.body,
			mind: character.mind,
			spirit: character.spirit,
			level: character.level,
			hp: 0,
			maxHp: 0,
			inventory: []
		};
		const stats = deriveStats(input);
		return {
			id: character.id,
			name: character.name,
			title: character.title,
			pronouns: character.pronouns,
			genderIdentity: character.genderIdentity,
			species: character.species,
			className: character.className,
			level: character.level,
			body: character.body,
			mind: character.mind,
			spirit: character.spirit,
			effectiveBody: stats.body,
			effectiveMind: stats.mind,
			effectiveSpirit: stats.spirit,
			skillValues: stats.skillValues,
			breakdowns: deriveStatBreakdowns(input),
			imageUrl: character.imageUrl,
			gearBonus: character.gearBonus,
			maxStartRoom: character.maxStartRoom,
			furthestDepth: character.furthestFloor,
			activeRunId: activeRunByCharacter.get(character.id)
		};
	});
	return {
		characters: cards,
		companyName: user.companyName || 'The Endless Company',
		companyGold: Number(account?.companyGold ?? 0)
	};
};

async function upgrade(event: Parameters<Actions[string]>[0], kind: UpgradeKind) {
	assertSameOrigin(event);
	const user = requireUser(event);
	const form = await event.request.formData();
	const characterId = uuidSchema.safeParse(form.get('characterId'));
	const stat = statSchema.safeParse(form.get('stat'));
	if (!characterId.success) return fail(400, { error: 'Invalid character.' });
	if (kind === 'level' && !stat.success)
		return fail(400, { error: 'Choose Body, Mind, or Spirit.' });

	type Result = { error: string; status: number } | { success: string };
	try {
		const result = await db.transaction(async (tx): Promise<Result> => {
			// Upgrade lock order: owned character, then user. Ownership is part of the locking query.
			const [character] = await tx
				.select()
				.from(characters)
				.where(and(eq(characters.id, characterId.data), eq(characters.userId, user.id)))
				.limit(1)
				.for('update');
			if (!character) return { error: 'Character not found.', status: 404 };
			if (character.retiredAt)
				return { error: 'Retired characters cannot be upgraded.', status: 409 };
			const [active] = await tx
				.select({ id: runs.id })
				.from(runs)
				.where(and(eq(runs.characterId, character.id), eq(runs.status, 'active')))
				.limit(1);
			if (active) return { error: 'Finish the active expedition before upgrading.', status: 409 };

			let cost: number;
			let values: Partial<typeof characters.$inferInsert>;
			let message: string;
			if (kind === 'level') {
				const targetLevel = character.level + 1;
				const selected = stat.data as PrimaryStat;
				const nextCost = levelUpgradeCost(targetLevel);
				if (nextCost === null) return { error: 'This character is already level 10.', status: 400 };
				if (
					!canIncreaseStat(
						character.level,
						character.body,
						character.mind,
						character.spirit,
						selected
					)
				)
					return { error: 'That stat cannot be increased at the next level.', status: 400 };
				cost = nextCost;
				values = { level: targetLevel, [selected]: character[selected] + 1 };
				message = `Reached level ${targetLevel}.`;
			} else if (kind === 'gear') {
				const target = character.gearBonus + 1;
				const nextCost = gearUpgradeCost(target);
				if (nextCost === null)
					return { error: 'Starting loot is already at 3 pieces.', status: 400 };
				cost = nextCost;
				values = { gearBonus: target };
				message = `Starting loot increased to ${target} pieces.`;
			} else {
				if (character.maxStartRoom >= 1000)
					return { error: 'Starting room access is already at the maximum.', status: 400 };
				cost = 5;
				values = { maxStartRoom: character.maxStartRoom + 1 };
				message = `Starting room access increased to ${character.maxStartRoom + 1}.`;
			}

			await tx
				.select({ id: users.id })
				.from(users)
				.where(eq(users.id, user.id))
				.limit(1)
				.for('update');
			const debited = await tx
				.update(users)
				.set({ companyGold: sql`${users.companyGold} - ${cost}`, updatedAt: new Date() })
				.where(and(eq(users.id, user.id), gte(users.companyGold, cost)))
				.returning({ id: users.id });
			if (!debited.length) return { error: `The company needs ${cost} gold.`, status: 400 };
			await tx
				.update(characters)
				.set({ ...values, updatedAt: new Date() })
				.where(and(eq(characters.id, character.id), eq(characters.userId, user.id)));
			return { success: message };
		});
		if ('error' in result) return fail(result.status, { error: result.error });
		return result;
	} catch {
		return fail(500, { error: 'The upgrade could not be completed.' });
	}
}

export const actions: Actions = {
	levelUp: (event) => upgrade(event, 'level'),
	gearUp: (event) => upgrade(event, 'gear'),
	roomUp: (event) => upgrade(event, 'room')
};
