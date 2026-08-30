import {
	SKILLS,
	type DerivedStats,
	type InventoryItem,
	type MonsterDefinition,
	type RoomSnapshot,
	type RunMeta,
	type SkillName,
	type StatBreakdown,
	type StatBreakdowns,
	type TrapDefinition,
	type TurnIntent,
	type TurnOutcome,
	type TurnNarrationMode
} from '$lib/types';
import { createRng, rollCheck, type RollCheckResult, type Rng } from './rng';

/*
 * Pure dungeon rules. Everything here is deterministic given its inputs; no
 * Math.random() is used anywhere. Routes persist the produced snapshots,
 * rolls and outcomes without re-running or mutating this logic.
 */

export type PrimaryStat = 'body' | 'mind' | 'spirit';

export const MAX_CHARACTER_LEVEL = 10;
export const MAX_GEAR_BONUS = 3;
export const MAX_START_ROOM = 1000;
export const GEAR_UPGRADE_COSTS = [25, 75, 225] as const;

/** Upper bound for company gold as a Drizzle bigint number; matches Number.MAX_SAFE_INTEGER. */
export const MAX_COMPANY_GOLD = Number.MAX_SAFE_INTEGER;

/**
 * Adds settlement gold to the current company wallet with checked arithmetic.
 * Both inputs must be nonnegative safe integers and the result must stay within
 * the Drizzle bigint-number safe range; otherwise a clear error is thrown.
 */
export function checkedCompanyGoldAdd(current: number, settlement: number): number {
	if (!Number.isSafeInteger(current) || current < 0) {
		throw new Error(`Company gold must be a nonnegative safe integer, got ${current}.`);
	}
	if (!Number.isSafeInteger(settlement) || settlement < 0) {
		throw new Error(`Settlement gold must be a nonnegative safe integer, got ${settlement}.`);
	}
	const next = current + settlement;
	if (!Number.isSafeInteger(next) || next > MAX_COMPANY_GOLD) {
		throw new Error(
			`Company gold ${current} + ${settlement} exceeds the safe limit ${MAX_COMPANY_GOLD}.`
		);
	}
	return next;
}

export function levelUpgradeCost(targetLevel: number): number | null {
	return Number.isInteger(targetLevel) && targetLevel >= 2 && targetLevel <= MAX_CHARACTER_LEVEL
		? targetLevel * 10
		: null;
}

export function gearUpgradeCost(targetBonus: number): number | null {
	return Number.isInteger(targetBonus) && targetBonus >= 1 && targetBonus <= MAX_GEAR_BONUS
		? GEAR_UPGRADE_COSTS[targetBonus - 1]
		: null;
}

export function validCharacterAge(age: number): boolean {
	return Number.isInteger(age) && age >= 1 && age <= 999;
}

/** Trims safe free-text character identity metadata and rejects controls or invalid lengths. */
export function normalizeCharacterIdentity(value: string | null): string | null {
	if (value === null) return null;
	const normalized = value.trim();
	if (normalized.length < 1 || normalized.length > 80 || /\p{Cc}/u.test(normalized)) return null;
	return normalized;
}

export function validImageUrl(value: string): boolean {
	if (value.length > 2048) return false;
	try {
		const parsed = new URL(value);
		return (
			(parsed.protocol === 'http:' || parsed.protocol === 'https:') && Boolean(parsed.hostname)
		);
	} catch {
		return false;
	}
}

export function canIncreaseStat(
	level: number,
	body: number,
	mind: number,
	spirit: number,
	stat: PrimaryStat
): boolean {
	const next = { body, mind, spirit };
	next[stat] += 1;
	return validateStatAllocation(level + 1, next.body, next.mind, next.spirit);
}

export function provisionPersistentGear(gearBonus: number): InventoryItem[] {
	return Array.from({ length: gearBonus }, (_, index) => ({
		kind: 'magic' as const,
		name: `Company gear +${index + 1}`,
		description: 'Persistent company equipment. It returns to the vault after the expedition.',
		stat: 'general' as const,
		sellable: false
	}));
}

export function settlementGold(
	inventory: readonly InventoryItem[],
	seed: string,
	roomNumber: number,
	version: number
): number {
	const rng = createRng(seed, roomNumber, version, 'settlement');
	return inventory.reduce(
		(total, item) => total + (item.sellable === false ? 0 : sellValue(item, rng)),
		0
	);
}

/** Maps each skill to the primary stat that governs it. */
export const SKILL_PRIMARY: Record<SkillName, PrimaryStat> = {
	Athletics: 'body',
	Stealth: 'body',
	Knowledge: 'mind',
	Magic: 'mind',
	Persuasion: 'spirit',
	Willpower: 'spirit'
};

export function skillPrimary(skill: SkillName): PrimaryStat {
	return SKILL_PRIMARY[skill];
}

/* ------------------------------------------------------------------ *
 * Per-run stat allocation
 * ------------------------------------------------------------------ */

/**
 * Validates an authoritative stat allocation for a run starting at `level`.
 * The three stats are integers, each non-negative, must sum to exactly the
 * level, and each may not exceed 3 for levels 1-9. At level 10 at most one
 * stat may equal 4 and none may exceed 4.
 */
export function validateStatAllocation(
	level: number,
	body: number,
	mind: number,
	spirit: number
): boolean {
	if (!Number.isInteger(level) || level < 1 || level > 10) return false;
	if (![body, mind, spirit].every((stat) => Number.isInteger(stat) && stat >= 0)) return false;
	if (body + mind + spirit !== level) return false;
	if (level <= 9) {
		return body <= 3 && mind <= 3 && spirit <= 3;
	}
	const atFour = [body, mind, spirit].filter((stat) => stat === 4).length;
	return atFour <= 1 && body <= 4 && mind <= 4 && spirit <= 4;
}

/** A new run must persist complete, internally consistent metadata. */
export function isValidNewRunMeta(meta: Partial<RunMeta>): meta is RunMeta {
	return (
		Number.isInteger(meta.startRoom) &&
		(meta.startRoom ?? 0) >= 1 &&
		Number.isInteger(meta.startLevel) &&
		Number.isInteger(meta.gearBonus) &&
		(meta.gearBonus ?? -1) >= 0 &&
		(meta.gearBonus ?? 4) <= 3 &&
		meta.allocatedBody !== undefined &&
		meta.allocatedMind !== undefined &&
		meta.allocatedSpirit !== undefined &&
		validateStatAllocation(
			meta.startLevel as number,
			meta.allocatedBody,
			meta.allocatedMind,
			meta.allocatedSpirit
		)
	);
}

/** Resolved base stats for a run: the meta allocation when valid, else legacy character stats. */
export function resolveRunBaseStats(
	runMeta: Partial<RunMeta> | undefined,
	legacy: { body: number; mind: number; spirit: number }
): { body: number; mind: number; spirit: number } {
	const { allocatedBody, allocatedMind, allocatedSpirit, startLevel } = runMeta ?? {};
	if (
		allocatedBody !== undefined &&
		allocatedMind !== undefined &&
		allocatedSpirit !== undefined &&
		typeof startLevel === 'number' &&
		validateStatAllocation(startLevel, allocatedBody, allocatedMind, allocatedSpirit)
	) {
		return { body: allocatedBody, mind: allocatedMind, spirit: allocatedSpirit };
	}
	return { body: legacy.body, mind: legacy.mind, spirit: legacy.spirit };
}

/* ------------------------------------------------------------------ *
 * Derived stats
 * ------------------------------------------------------------------ */

export const DEFAULT_GEAR_CAP = 5;
const GEAR_BONUS_PER_ITEM = 1;

export interface StatInput {
	body: number;
	mind: number;
	spirit: number;
	level: number;
	hp: number;
	maxHp: number;
	defense: number;
	inventory?: readonly InventoryItem[];
	gearCap?: number;
}

function deriveStatResult(input: StatInput): { stats: DerivedStats; breakdowns: StatBreakdowns } {
	const gearCap = input.gearCap ?? DEFAULT_GEAR_CAP;
	const generalBonus = { body: 0, mind: 0, spirit: 0 };
	const matchingBonus = { body: 0, mind: 0, spirit: 0 };
	const skillBonus: Partial<Record<SkillName, number>> = {};
	let attackBonus = 0;
	let defenseBonus = 0;

	for (const item of input.inventory ?? []) {
		if (item.kind !== 'magic') continue;
		switch (item.stat) {
			case 'body':
				matchingBonus.body += GEAR_BONUS_PER_ITEM;
				break;
			case 'mind':
				matchingBonus.mind += GEAR_BONUS_PER_ITEM;
				break;
			case 'spirit':
				matchingBonus.spirit += GEAR_BONUS_PER_ITEM;
				break;
			case 'general':
				generalBonus.body += GEAR_BONUS_PER_ITEM;
				generalBonus.mind += GEAR_BONUS_PER_ITEM;
				generalBonus.spirit += GEAR_BONUS_PER_ITEM;
				break;
			case 'skill':
				if (item.skill)
					skillBonus[item.skill] = (skillBonus[item.skill] ?? 0) + GEAR_BONUS_PER_ITEM;
				break;
			case 'attack':
				attackBonus += GEAR_BONUS_PER_ITEM;
				break;
			case 'defense':
				defenseBonus += GEAR_BONUS_PER_ITEM;
				break;
		}
	}

	const effectivePrimary = (stat: PrimaryStat): number =>
		input[stat] + Math.min(generalBonus[stat] + matchingBonus[stat], gearCap);
	const body = effectivePrimary('body');
	const mind = effectivePrimary('mind');
	const spirit = effectivePrimary('spirit');

	const skillValues = {} as Record<SkillName, number>;
	for (const skill of SKILLS) {
		const primary = SKILL_PRIMARY[skill];
		const base = primary === 'body' ? body : primary === 'mind' ? mind : spirit;
		skillValues[skill] = base + (skillBonus[skill] ?? 0);
	}

	const stats: DerivedStats = {
		body,
		mind,
		spirit,
		instinct: body + mind + spirit,
		hp: input.hp,
		defense: input.defense + defenseBonus,
		attackBonus: body + mind + spirit + attackBonus,
		skillValues
	};

	const attributeBreakdown = (stat: PrimaryStat): StatBreakdown => {
		const label = stat[0].toUpperCase() + stat.slice(1);
		const uncappedBonus = generalBonus[stat] + matchingBonus[stat];
		const capAdjustment = Math.min(uncappedBonus, gearCap) - uncappedBonus;
		return {
			label,
			total: stats[stat],
			parts: [
				{ label: `${label} base`, value: input[stat] },
				{ label: 'General equipment', value: generalBonus[stat] },
				{ label: `${label} equipment`, value: matchingBonus[stat] },
				...(capAdjustment < 0 ? [{ label: `Gear cap (${gearCap})`, value: capAdjustment }] : [])
			],
			formula: `Base + equipment (equipment capped at ${gearCap})`
		};
	};
	const attributes = {
		body: attributeBreakdown('body'),
		mind: attributeBreakdown('mind'),
		spirit: attributeBreakdown('spirit')
	};
	const skills = {} as Record<SkillName, StatBreakdown>;
	for (const skill of SKILLS) {
		const primary = SKILL_PRIMARY[skill];
		const primaryLabel = primary[0].toUpperCase() + primary.slice(1);
		skills[skill] = {
			label: skill,
			total: skillValues[skill],
			parts: [
				{ label: primaryLabel, value: stats[primary] },
				{ label: `${skill} equipment`, value: skillBonus[skill] ?? 0 }
			]
		};
	}
	const defenseBase = input.defense - input.level;
	return {
		stats,
		breakdowns: {
			attributes,
			skills,
			instinct: {
				label: 'Instinct',
				total: stats.instinct,
				parts: [
					{ label: 'Body', value: body },
					{ label: 'Mind', value: mind },
					{ label: 'Spirit', value: spirit }
				],
				formula:
					'Effective Body + Effective Mind + Effective Spirit; forms the attribute portion of Attack.'
			},
			defense: {
				label: 'Defense',
				total: stats.defense,
				parts: [
					{ label: 'Base', value: defenseBase },
					{ label: 'Level', value: input.level },
					{ label: 'Defense equipment', value: defenseBonus }
				]
			},
			attack: {
				label: 'Attack',
				total: stats.attackBonus,
				parts: [
					{ label: 'Effective Body', value: body },
					{ label: 'Effective Mind', value: mind },
					{ label: 'Effective Spirit', value: spirit },
					{ label: 'Attack equipment', value: attackBonus }
				],
				formula: 'Effective Body + Effective Mind + Effective Spirit (Instinct) + Attack equipment'
			}
		}
	};
}

/** Effective stats after applying carried magic gear, with primary gear capped. */
export function deriveStats(input: StatInput): DerivedStats {
	return deriveStatResult(input).stats;
}

/** Explanations produced by the same calculation as deriveStats. */
export function deriveStatBreakdowns(input: StatInput): StatBreakdowns {
	return deriveStatResult(input).breakdowns;
}

/* ------------------------------------------------------------------ *
 * Descriptive generated names
 * ------------------------------------------------------------------ */

const MAGIC_ITEM_WORDS = [
	'Blade',
	'Ring',
	'Sigil',
	'Mantle',
	'Amulet',
	'Glaive',
	'Circlet',
	'Greaves',
	'Bracer',
	'Lantern'
];
const MAGIC_ESSENCES = [
	'Searing Sun',
	'Ebon Ward',
	'Runic Dawn',
	'Thorned Crown',
	'Ember Heart',
	'Frost Veil',
	'Warding Light',
	'Deep Star',
	'Restless Wind',
	'Quiet Moon'
];
const DRAUGHT_VIRTUES = [
	'Swift Mending',
	'Deep Rest',
	'Bitter Vigor',
	'Clarity',
	'Quiet Revival',
	'Ember Balm',
	'Still Water'
];
const VALUABLE_FORMS = ['Chalice', 'Idol', 'Crown', 'Scroll', 'Hourglass', 'Seal', 'Mask', 'Coins'];

function magicItemName(rng: Rng): string {
	return `${rng.pick(MAGIC_ITEM_WORDS)} of the ${rng.pick(MAGIC_ESSENCES)}`;
}

function draughtName(rng: Rng): string {
	return `Draught of ${rng.pick(DRAUGHT_VIRTUES)}`;
}

function valuableName(rng: Rng): string {
	return `Gilded ${rng.pick(VALUABLE_FORMS)}`;
}

const MAGIC_STATS: Array<InventoryItem['stat']> = [
	'attack',
	'defense',
	'body',
	'mind',
	'spirit',
	'skill'
];

function generateMagicItem(rng: Rng): InventoryItem {
	const stat = rng.pick(MAGIC_STATS);
	const item: InventoryItem = { kind: 'magic', name: magicItemName(rng), stat };
	if (stat === 'skill') item.skill = rng.pick(SKILLS);
	if (stat === 'body' || stat === 'mind' || stat === 'spirit' || stat === 'general') {
		item.description = `Boosts your ${stat} while carried.`;
	} else if (stat === 'attack' || stat === 'defense') {
		item.description = `Boosts your ${stat} while carried.`;
	} else if (stat === 'skill' && item.skill) {
		item.description = `Boosts your ${item.skill} while carried.`;
	}
	return item;
}

function generateDraught(rng: Rng): InventoryItem {
	return { kind: 'draught', name: draughtName(rng), description: 'An immediate healing draught.' };
}

function generateValuable(rng: Rng): InventoryItem {
	return { kind: 'valuable', name: valuableName(rng), description: 'Sells at settlement.' };
}

/** Builds a reward pool split into equal thirds: magic, draught, valuable. */
export function generateRewardPool(rng: Rng, size = 3): InventoryItem[] {
	const third = Math.floor(size / 3);
	const pool: InventoryItem[] = [];
	for (let i = 0; i < third; i++) pool.push(generateMagicItem(rng));
	for (let i = 0; i < third; i++) pool.push(generateDraught(rng));
	for (let i = 0; i < size - third * 2; i++) pool.push(generateValuable(rng));
	// Deterministic Fisher-Yates shuffle.
	for (let i = pool.length - 1; i > 0; i--) {
		const j = rng.range(0, i);
		const tmp = pool[i];
		pool[i] = pool[j];
		pool[j] = tmp;
	}
	return pool;
}

/** Gold a settlement pays for an item; magic 1d2, valuable 1d6, draught none. */
export function sellValue(item: InventoryItem, rng: Rng): number {
	switch (item.kind) {
		case 'magic':
			return rng.range(1, 2);
		case 'valuable':
			return rng.range(1, 6);
		case 'draught':
			return 0;
	}
}

/* ------------------------------------------------------------------ *
 * Fallback definitions
 * ------------------------------------------------------------------ */

export const FALLBACK_MONSTERS: readonly MonsterDefinition[] = [
	{
		id: 'fallback-monster-1',
		name: 'Charnel Crawler',
		tier: 1,
		hp: 8,
		defense: 8,
		temperament: 'Skittish, chittering'
	},
	{
		id: 'fallback-monster-2',
		name: 'Brine Husk',
		tier: 2,
		hp: 14,
		defense: 11,
		temperament: 'Slow, implacable'
	},
	{
		id: 'fallback-monster-3',
		name: 'Vault Stalker',
		tier: 3,
		hp: 20,
		defense: 14,
		temperament: 'Patient, shadowed'
	}
];

export const FALLBACK_TRAPS: readonly TrapDefinition[] = [
	{
		id: 'fallback-trap-1',
		name: 'Cinder Thread',
		tier: 1,
		target: 8,
		skill: 'Stealth',
		consequence: 'Burns vitality'
	},
	{
		id: 'fallback-trap-2',
		name: 'Bell Without a Tongue',
		tier: 2,
		target: 10,
		skill: 'Knowledge',
		consequence: 'Awakens the wax congregation'
	},
	{
		id: 'fallback-trap-3',
		name: 'Gravity Catch',
		tier: 3,
		target: 12,
		skill: 'Athletics',
		consequence: 'Drops you into a lightless pit'
	}
];

function selectMonster(rng: Rng, monsters: readonly MonsterDefinition[]): MonsterDefinition {
	const pool = monsters.length > 0 ? monsters : FALLBACK_MONSTERS;
	return rng.pick(pool);
}

function selectTrap(rng: Rng, traps: readonly TrapDefinition[]): TrapDefinition {
	const pool = traps.length > 0 ? traps : FALLBACK_TRAPS;
	return rng.pick(pool);
}

/**
 * Composes the description snapshot for a monster (or boss) room. When the
 * run's debauchery calls for adult content the normal description is kept and
 * the debauched description follows it, separated by a paragraph break;
 * it is never a replacement. When either part is missing the other (or the
 * deterministic fallback) is used on its own.
 */
function composeMonsterDescription(
	debauchery: number | undefined,
	monster: MonsterDefinition,
	fallback: string
): string {
	const normal = monster.description?.trim();
	const debauched = monster.debauchedDescription?.trim();
	if (debauchery !== undefined && debauchery >= 2) {
		if (normal && debauched) return `${normal}\n\n${debauched}`;
		if (debauched) return debauched;
	}
	return normal || fallback;
}

/* ------------------------------------------------------------------ *
 * Room generation
 * ------------------------------------------------------------------ */

export const BOSS_TARGET_BONUS = 2;
export const TRAP_DC_BASE = 5;
export const BOSS_REWARD_POOL_SIZE = 6;
export const TREASURE_REWARD_POOL_SIZE = 3;
export const BOSS_REWARDS_ON_SUCCESS = 2;
export const HP_LOSS_ON_FAILURE = 1;
export const REST_HEAL = 1;
export const DRAUGHT_HEAL = 1;
const ENCOUNTER_REWARD_POOL_PURPOSE = 'encounter-reward-pool';
const LOOT_SEARCH_PURPOSE = 'loot-search';

export interface GenerateRoomInput {
	seed: string;
	room: number;
	turn: number;
	debauchery?: number;
	monsters: readonly MonsterDefinition[];
	traps: readonly TrapDefinition[];
}

/** Missing persisted narration modes are ordinary actions. */
export function normalizeNarrationMode(mode?: TurnNarrationMode): TurnNarrationMode {
	return mode ?? 'ordinary_action';
}

/**
 * Materializes the authoritative reward pool for encounter rooms. Existing
 * non-empty pools are returned by reference so snapshots are never rerolled.
 */
export function ensureEncounterRewardPool(
	room: RoomSnapshot,
	seed: string,
	roomNumber: number
): RoomSnapshot {
	if (!['monster', 'trap', 'boss'].includes(room.type) || (room.rewards?.length ?? 0) > 0) {
		return room;
	}
	const size = room.type === 'boss' ? BOSS_REWARD_POOL_SIZE : TREASURE_REWARD_POOL_SIZE;
	const rng = createRng(seed, roomNumber, 0, `${ENCOUNTER_REWARD_POOL_PURPOSE}:${room.type}`);
	return { ...room, rewards: generateRewardPool(rng, size) };
}

export interface EncounterLootDraw {
	/** All discovered items, including immediately consumed draughts. */
	rewards: InventoryItem[];
	/** Only items that should be appended to inventory. */
	carriedRewards: InventoryItem[];
	/** Compatibility aliases for callers that use draw-oriented terminology. */
	drawn: InventoryItem[];
	carried: InventoryItem[];
	consumedDraughts: InventoryItem[];
	consumedDraughtCount: number;
}

/** Draws stable post-encounter loot without changing the persisted reward pool. */
export function drawEncounterLoot(
	room: RoomSnapshot,
	seed: string,
	roomNumber: number
): EncounterLootDraw {
	const count = room.type === 'boss' ? BOSS_REWARDS_ON_SUCCESS : 1;
	const available = [...(room.rewards ?? [])];
	const rng = createRng(seed, roomNumber, 0, LOOT_SEARCH_PURPOSE);
	const drawn: InventoryItem[] = [];
	for (let i = 0; i < count && available.length > 0; i++) {
		drawn.push(available.splice(rng.range(0, available.length - 1), 1)[0]);
	}
	const carried = drawn.filter((item) => item.kind !== 'draught');
	const consumedDraughts = drawn.filter((item) => item.kind === 'draught');
	return {
		rewards: drawn,
		carriedRewards: carried,
		drawn,
		carried,
		consumedDraughts,
		consumedDraughtCount: consumedDraughts.length
	};
}

export interface AppliedLoot {
	inventory: InventoryItem[];
	hpAfter: number;
	hpDelta: number;
}

/** Applies an authoritative draw: gear is carried and each draught heals one HP. */
export function applyLoot(
	inventory: readonly InventoryItem[],
	hp: number,
	maxHp: number,
	loot: {
		carriedRewards?: readonly InventoryItem[];
		carried?: readonly InventoryItem[];
		consumedDraughtCount: number;
	}
): AppliedLoot {
	const hpAfter = Math.min(maxHp, hp + loot.consumedDraughtCount * DRAUGHT_HEAL);
	const carried = loot.carriedRewards ?? loot.carried ?? [];
	return { inventory: [...inventory, ...carried], hpAfter, hpDelta: hpAfter - hp };
}

/** Normalizes old outcomes whose rewards represented both carried and consumed items. */
export function normalizeTurnOutcome(outcome: TurnOutcome): TurnOutcome {
	if (outcome.carriedRewards) return outcome;
	return {
		...outcome,
		carriedRewards: (outcome.rewards ?? []).filter((item) => item.kind !== 'draught')
	};
}

export type EncounterOutcomeClass = 'success' | 'failure' | 'fatal';

/** Classifies an authoritative encounter result for the next durable phase. */
export function classifyEncounterOutcome(outcome: TurnOutcome): EncounterOutcomeClass {
	if (outcome.result === 'defeat' || outcome.hpAfter <= 0) return 'fatal';
	if (outcome.result === 'failure') return 'failure';
	return 'success';
}

const KIND_WEIGHTS = [
	{ kind: 'monster' as const, weight: 50 },
	{ kind: 'trap' as const, weight: 20 },
	{ kind: 'treasure' as const, weight: 10 },
	{ kind: 'rest' as const, weight: 10 }
];

/**
 * Generates the immutable snapshot for a room. Positive multiples of five are
 * boss rooms; other rooms follow the normalized monster/trap/treasure/rest
 * weights. Empty definition lists fall back to the deterministic built-ins.
 */
export function generateRoom(input: GenerateRoomInput): RoomSnapshot {
	const rng = createRng(input.seed, input.room, input.turn, 'room');
	const isBoss = input.room > 0 && input.room % 5 === 0;

	if (isBoss) {
		const monster = selectMonster(rng, input.monsters);
		const description = composeMonsterDescription(
			input.debauchery,
			monster,
			`A chamber holds a monstrous guardian: ${monster.name}. ${monster.temperament}.`
		);
		return ensureEncounterRewardPool(
			{
				type: 'boss',
				boss: true,
				name: monster.name,
				description,
				defense: monster.defense + BOSS_TARGET_BONUS
			},
			input.seed,
			input.room
		);
	}

	const kind = rng.weighted(KIND_WEIGHTS).kind;
	switch (kind) {
		case 'monster': {
			const monster = selectMonster(rng, input.monsters);
			const description = composeMonsterDescription(
				input.debauchery,
				monster,
				`${monster.name} lurks here. ${monster.temperament}.`
			);
			return ensureEncounterRewardPool(
				{
					type: 'monster',
					name: monster.name,
					description,
					defense: monster.defense
				},
				input.seed,
				input.room
			);
		}
		case 'trap': {
			const trap = selectTrap(rng, input.traps);
			return ensureEncounterRewardPool(
				{
					type: 'trap',
					name: trap.name,
					description: trap.description?.trim() || `${trap.name}. ${trap.consequence}.`,
					dc: TRAP_DC_BASE + Math.floor(input.room / 5),
					skill: trap.skill
				},
				input.seed,
				input.room
			);
		}
		case 'treasure':
			return {
				type: 'treasure',
				name: 'Hidden Hoard',
				description: 'A promising cache of goods waits to be claimed.',
				rewards: generateRewardPool(rng, TREASURE_REWARD_POOL_SIZE)
			};
		case 'rest':
			return {
				type: 'rest',
				name: 'Quiet Nook',
				description: 'A safe corner where you can catch your breath.'
			};
	}
}

/* ------------------------------------------------------------------ *
 * Action intent mapping
 * ------------------------------------------------------------------ */

export type ActionApproach = 'skill' | 'combat' | 'none';

export interface MappedIntent {
	approach: ActionApproach;
	skill?: SkillName;
	/** Always clamped to -2..2. */
	advantage: number;
}

const COMBAT_KEYWORDS = [
	'attack',
	'strike',
	'fight',
	'charge',
	'smite',
	'bash',
	'kill',
	'slay',
	'swing',
	'hit',
	'combat',
	'engage',
	'stab',
	'shoot'
];

const SKILL_KEYWORDS: Record<SkillName, string[]> = {
	Athletics: [
		'climb',
		'jump',
		'push',
		'lift',
		'sprint',
		'run',
		'swim',
		'break',
		'force',
		'strength'
	],
	Knowledge: ['read', 'study', 'recall', 'inscribe', 'translate', 'research', 'lore', 'decipher'],
	Magic: ['cast', 'spell', 'enchant', 'channel', 'arcane', 'invoke', 'weave', 'conjure'],
	Persuasion: ['persuade', 'charm', 'bargain', 'negotiate', 'coax', 'flatter', 'talk', 'bribe'],
	Stealth: ['sneak', 'hide', 'creep', 'prowl', 'silent', 'shadow', 'steal', 'skulk'],
	Willpower: ['resist', 'endure', 'steady', 'focus', 'brace', 'withstand', 'resolve', 'temper']
};

function clampAdvantage(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.max(-2, Math.min(2, Math.round(value)));
}

/**
 * Maps a typed action (or free text) to the bounded intent shape. The result
 * can only ever be `{approach, skill?, advantage}` with advantage in -2..2,
 * which is exactly the shape model output is constrained to as well.
 */
export function mapActionIntent(raw: {
	method?: string;
	skill?: string;
	advantage?: number;
	text?: string;
	room?: RoomSnapshot;
}): MappedIntent {
	const text = (raw.text ?? '').toLowerCase();
	const method = (raw.method ?? '').toLowerCase();

	let approach: ActionApproach;
	let skill: SkillName | undefined;

	if (method === 'skill' || method === 'combat' || method === 'none') {
		approach = method;
	} else if (COMBAT_KEYWORDS.some((word) => text.includes(word))) {
		approach = 'combat';
	} else {
		const matched = SKILLS.find((candidate) =>
			SKILL_KEYWORDS[candidate].some((word) => text.includes(word))
		);
		if (matched) {
			approach = 'skill';
			skill = matched;
		} else {
			approach = 'combat';
		}
	}

	const requestedSkill = raw.skill as SkillName | undefined;
	if (requestedSkill && SKILLS.includes(requestedSkill)) {
		skill = requestedSkill;
	}

	const mapped = { approach, skill, advantage: clampAdvantage(raw.advantage ?? 0) };
	if (raw.room) return normalizeActionIntent(raw.room, mapped);
	return mapped.approach === 'none' ? { approach: 'combat', advantage: mapped.advantage } : mapped;
}

/** Enforces which bounded approaches are valid for the authoritative room type. */
export function normalizeActionIntent(room: RoomSnapshot, mapped: MappedIntent): MappedIntent {
	const advantage = clampAdvantage(mapped.advantage);
	if (room.type === 'treasure' || room.type === 'rest') {
		return { approach: 'none', advantage };
	}
	if (mapped.approach !== 'none') {
		return {
			approach: mapped.approach,
			...(mapped.approach === 'skill' && mapped.skill ? { skill: mapped.skill } : {}),
			advantage
		};
	}
	if (room.type === 'trap') {
		return { approach: 'skill', skill: roomSkill(room), advantage };
	}
	return { approach: 'combat', advantage };
}

/** Converts the bounded intent into the persisted TurnIntent shape. */
export function toTurnIntent(mapped: MappedIntent): TurnIntent {
	return {
		method: mapped.approach,
		...(mapped.skill ? { skill: mapped.skill } : {}),
		advantage: mapped.advantage
	};
}

/** The skill an encounter should use when the intent left it unspecified. */
export function roomSkill(room: RoomSnapshot): SkillName {
	if (room.skill) return room.skill;
	return 'Athletics';
}

/* ------------------------------------------------------------------ *
 * Encounter resolution
 * ------------------------------------------------------------------ */

export interface EncounterInput {
	seed: string;
	roomNumber: number;
	turn: number;
	room: RoomSnapshot;
	intent: TurnIntent;
	stats: DerivedStats;
	hp: number;
	maxHp: number;
}

export interface EncounterResult {
	outcome: TurnOutcome;
	rolls: RollCheckResult[];
}

/** Treasure compatibility draw; encounter loot uses drawEncounterLoot after resolution. */
function drawImmediateRewards(
	pool: InventoryItem[],
	count: number,
	rng: Rng,
	hpAfter: number,
	maxHp: number
) {
	const drawn: InventoryItem[] = [];
	const carried: InventoryItem[] = [];
	for (let i = 0; i < count && pool.length > 0; i++) {
		const index = rng.range(0, pool.length - 1);
		const item = pool.splice(index, 1)[0];
		drawn.push(item);
		if (item.kind === 'draught') {
			hpAfter = Math.min(maxHp, hpAfter + DRAUGHT_HEAL);
		} else {
			carried.push(item);
		}
	}
	return { drawn, carried, hpAfter };
}

/**
 * Resolves one encounter into an immutable outcome. Combat checks the attack
 * bonus against the room's defense, traps check the named skill against the
 * DC; a failed check costs 1 HP. Rest rooms always heal. Encounter success
 * does not draw rewards; post-encounter loot is resolved separately.
 */
export function resolveEncounter(input: EncounterInput): EncounterResult {
	const { room, intent, stats, hp, maxHp } = input;
	const rng = createRng(input.seed, input.roomNumber, input.turn, 'encounter');
	const rolls: RollCheckResult[] = [];

	const hpBefore = hp;
	let hpAfter = hp;
	let result: TurnOutcome['result'] = 'success';
	let message = '';
	let rewards: InventoryItem[] = [];
	let carriedRewards: InventoryItem[] = [];
	let gold: number | undefined;
	let injury: string | undefined;

	switch (room.type) {
		case 'monster':
		case 'boss': {
			const target = room.defense ?? 8;
			if (intent.method === 'skill' && intent.skill) {
				const skill = intent.skill;
				const check = rollCheck(
					stats.skillValues[skill],
					target,
					intent.advantage,
					`${skill} check`,
					rng
				);
				rolls.push(check);
				if (check.success) {
					result = 'reward';
					message = `You slip past ${room.name ?? 'the monster'} undetected.`;
				} else {
					hpAfter = Math.max(0, hpAfter - HP_LOSS_ON_FAILURE);
					result = 'failure';
					message = `${room.name ?? 'The monster'} catches you and you take a wound.`;
					injury = 'caught while sneaking';
				}
			} else {
				const check = rollCheck(
					stats.attackBonus,
					target,
					intent.advantage,
					room.type === 'boss' ? 'Attack the boss' : 'Attack',
					rng
				);
				rolls.push(check);
				if (check.success) {
					result = 'reward';
					message =
						room.type === 'boss' ? `You slay the boss ${room.name}.` : `You defeat ${room.name}.`;
				} else {
					hpAfter = Math.max(0, hpAfter - HP_LOSS_ON_FAILURE);
					result = 'failure';
					message = `${room.name ?? 'The monster'} overpowers you and you take a wound.`;
					injury = 'wounded in combat';
				}
			}
			break;
		}
		case 'trap': {
			const target = room.dc ?? 10;
			const skill = room.skill ?? 'Athletics';
			const check = rollCheck(
				intent.method === 'combat' ? stats.attackBonus : stats.skillValues[skill],
				target,
				intent.advantage,
				intent.method === 'combat' ? 'Smash through the trap' : `${skill} check`,
				rng
			);
			rolls.push(check);
			if (check.success) {
				result = 'reward';
				message = `You get past ${room.name}.`;
			} else {
				hpAfter = Math.max(0, hpAfter - HP_LOSS_ON_FAILURE);
				result = 'failure';
				message = room.description ?? `${room.name} springs its trap on you.`;
				injury = 'trap damage';
			}
			break;
		}
		case 'treasure': {
			const pool = [...(room.rewards ?? [])];
			if (pool.length === 0) {
				result = 'rest';
				message = 'The chamber is empty.';
				break;
			}
			const drawn = drawImmediateRewards(pool, 1, rng, hpAfter, maxHp);
			rewards = drawn.drawn;
			carriedRewards = drawn.carried;
			hpAfter = drawn.hpAfter;
			result = 'reward';
			message = `You claim the ${room.name ?? 'hidden hoard'}.`;
			break;
		}
		case 'rest': {
			hpAfter = Math.min(maxHp, hpAfter + REST_HEAL);
			result = 'rest';
			message = 'You rest in the quiet nook and recover 1 HP.';
			break;
		}
	}

	if (hpAfter <= 0) {
		result = 'defeat';
		message = 'Your strength fails and the dungeon claims you.';
	}

	const outcome: TurnOutcome = {
		result,
		hpBefore,
		hpAfter,
		hpDelta: hpAfter - hpBefore,
		message,
		...(rewards.length > 0 ? { rewards } : {}),
		...(rewards.length > 0 ? { carriedRewards } : {}),
		...(injury ? { injury } : {}),
		...(gold !== undefined ? { gold } : {})
	};

	return { outcome, rolls };
}
