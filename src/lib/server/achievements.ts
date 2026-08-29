/*
 * Stable achievement definitions and eligibility helpers. Route integration
 * (persisting unlocks to the achievements tables) comes later; these pure
 * helpers only compute which keys are newly eligible for a given state.
 */

export interface AchievementDef {
	key: string;
	name: string;
	description: string;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
	{ key: 'first-entry', name: 'First Steps', description: 'Enter the dungeon for the first time.' },
	{
		key: 'first-defeat',
		name: 'First Fall',
		description: 'Fall to the dungeon for the first time.'
	},
	{ key: 'double-digits', name: 'Double Digits', description: 'Reach room number 10 or beyond.' },
	{ key: 'gold-100', name: 'Pocket of Gold', description: 'Accumulate 100 gold.' },
	{ key: 'gold-1000', name: "A King's Ransom", description: 'Accumulate 1000 gold.' }
];

export const ACHIEVEMENT_KEYS: readonly string[] = ACHIEVEMENTS.map((a) => a.key);

/** Finds a definition by key, or undefined when the key is unknown. */
export function achievementByKey(key: string): AchievementDef | undefined {
	return ACHIEVEMENTS.find((a) => a.key === key);
}

export interface AchievementProgress {
	entered: boolean;
	firstDefeat: boolean;
	roomNumber: number;
	gold: number;
}

/** All achievement keys satisfied by the given progress. */
export function eligibleKeys(progress: AchievementProgress): string[] {
	const keys: string[] = [];
	if (progress.entered) keys.push('first-entry');
	if (progress.firstDefeat) keys.push('first-defeat');
	if (progress.roomNumber >= 10) keys.push('double-digits');
	if (progress.gold >= 100) keys.push('gold-100');
	if (progress.gold >= 1000) keys.push('gold-1000');
	return keys;
}

/** Keys satisfied by progress but not yet present in the unlocked set. */
export function newlyEligible(
	progress: AchievementProgress,
	unlocked: readonly string[]
): string[] {
	const have = new Set(unlocked);
	return eligibleKeys(progress).filter((key) => !have.has(key));
}
