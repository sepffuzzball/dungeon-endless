import { and, eq, isNull, sql } from 'drizzle-orm';
import type { CharacterCard, DashboardAchievement, RunSummary } from '$lib/types';
import { requireUser } from '$lib/server/authorization';
import { db } from '$lib/server/db';
import { deriveStatBreakdowns, deriveStats } from '$lib/server/game';
import { achievements, characters, runs, userAchievements, users } from '$lib/server/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const user = requireUser(event);

	const characterRows = await db
		.select()
		.from(characters)
		.where(and(eq(characters.userId, user.id), isNull(characters.retiredAt)));

	const activeRows = await db
		.select({ runId: runs.id, characterId: runs.characterId })
		.from(runs)
		.where(and(eq(runs.userId, user.id), eq(runs.status, 'active')));
	const activeRunByCharacter = new Map(activeRows.map((row) => [row.characterId, row.runId]));

	const charactersView: CharacterCard[] = characterRows.map((row) => {
		const input = {
			body: row.body,
			mind: row.mind,
			spirit: row.spirit,
			level: row.level,
			hp: 0,
			maxHp: 0,
			defense: 5 + row.level,
			inventory: []
		};
		const stats = deriveStats(input);
		return {
			id: row.id,
			name: row.name,
			title: row.title,
			pronouns: row.pronouns,
			genderIdentity: row.genderIdentity,
			species: row.species,
			className: row.className,
			level: row.level,
			body: row.body,
			mind: row.mind,
			spirit: row.spirit,
			effectiveBody: stats.body,
			effectiveMind: stats.mind,
			effectiveSpirit: stats.spirit,
			skillValues: stats.skillValues,
			breakdowns: deriveStatBreakdowns(input),
			imageUrl: row.imageUrl,
			gearBonus: row.gearBonus,
			maxStartRoom: row.maxStartRoom,
			furthestDepth: row.furthestFloor,
			activeRunId: activeRunByCharacter.get(row.id)
		};
	});

	const activeRunRows = await db
		.select({
			id: runs.id,
			characterName: characters.name,
			depth: runs.roomNumber,
			hp: runs.hp,
			maxHp: runs.maxHp,
			status: runs.status
		})
		.from(runs)
		.innerJoin(characters, eq(runs.characterId, characters.id))
		.where(and(eq(runs.userId, user.id), eq(characters.userId, user.id), eq(runs.status, 'active')))
		.orderBy(runs.startedAt);

	const activeRuns: RunSummary[] = activeRunRows.map((row) => ({
		id: row.id,
		characterName: row.characterName,
		depth: row.depth,
		hp: row.hp,
		maxHp: row.maxHp,
		status: row.status
	}));

	const [charAgg] = await db
		.select({ furthestFloor: sql<number>`coalesce(max(${characters.furthestFloor}), 0)::int` })
		.from(characters)
		.where(eq(characters.userId, user.id));

	const [runAgg] = await db
		.select({
			runs: sql<number>`count(*)::int`,
			defeats: sql<number>`coalesce(sum(case when ${runs.status} = 'defeated' then 1 else 0 end), 0)::int`
		})
		.from(runs)
		.where(eq(runs.userId, user.id));
	const [account] = await db
		.select({ companyGold: users.companyGold })
		.from(users)
		.where(eq(users.id, user.id))
		.limit(1);

	const achievementRows = await db
		.select({
			key: achievements.key,
			name: achievements.name,
			description: achievements.description,
			userId: userAchievements.userId
		})
		.from(achievements)
		.leftJoin(
			userAchievements,
			and(eq(userAchievements.achievementId, achievements.id), eq(userAchievements.userId, user.id))
		)
		.orderBy(achievements.key);

	const achievementsView: DashboardAchievement[] = achievementRows.map((row) => ({
		key: row.key,
		name: row.name,
		description: row.description,
		unlocked: row.userId !== null
	}));

	return {
		companyName: user.companyName || 'The Endless Company',
		characters: charactersView,
		activeRuns,
		records: {
			furthestFloor: Number(charAgg?.furthestFloor ?? 0),
			gold: Number(account?.companyGold ?? 0),
			runs: Number(runAgg?.runs ?? 0),
			defeats: Number(runAgg?.defeats ?? 0)
		},
		achievements: achievementsView
	};
};
