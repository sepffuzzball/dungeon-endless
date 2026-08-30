import { describe, it, expect } from 'vitest';
import {
	BOSS_TARGET_BONUS,
	FALLBACK_MONSTERS,
	MAX_COMPANY_GOLD,
	TRAP_DC_BASE,
	checkedCompanyGoldAdd,
	abandonSettlementGold,
	applyLoot,
	classifyEncounterOutcome,
	deriveStatBreakdowns,
	deriveStats,
	canIncreaseStat,
	gearUpgradeCost,
	formatDice,
	formatItemEffects,
	generateDraught,
	generateMagicItem,
	generateRewardPool,
	generateValuable,
	generateRoom,
	drawEncounterLoot,
	ensureEncounterRewardPool,
	isValidNewRunMeta,
	levelUpgradeCost,
	mapActionIntent,
	normalizeActionIntent,
	normalizeNarrationMode,
	normalizeInventoryItem,
	normalizeTurnOutcome,
	provisionExpeditionLoot,
	resolveEncounter,
	resolveRunBaseStats,
	settlementGold,
	selectLootRarity,
	sellValue,
	skillPrimary,
	toTurnIntent,
	validateStatAllocation,
	validCharacterAge,
	validImageUrl
} from '../src/lib/server/game';
import { createRng, type Rng } from '../src/lib/server/rng';
import { runPhaseEnum } from '../src/lib/server/schema';
import type {
	DerivedStats,
	InventoryItem,
	ItemRarity,
	RoomSnapshot,
	RunPhase,
	TurnIntent,
	TurnNarrationMode
} from '../src/lib/types';

function baseStats(overrides?: Partial<DerivedStats>): DerivedStats {
	return {
		body: 3,
		mind: 3,
		spirit: 3,
		instinct: 9,
		hp: 10,
		defense: 10,
		attackBonus: 2,
		skillValues: {
			Athletics: 3,
			Knowledge: 3,
			Magic: 3,
			Persuasion: 3,
			Stealth: 3,
			Willpower: 3
		},
		...overrides
	};
}

function room(partial: Partial<RoomSnapshot> & { type: RoomSnapshot['type'] }): RoomSnapshot {
	return { name: 'The Room', ...partial };
}

function resolve(
	roomData: RoomSnapshot,
	intent: TurnIntent,
	stats: DerivedStats = baseStats(),
	hp = 10,
	maxHp = 10
) {
	return resolveEncounter({
		seed: 'test-seed',
		roomNumber: 1,
		turn: 1,
		room: roomData,
		intent,
		stats,
		hp,
		maxHp
	});
}

describe('durable resolution types', () => {
	it('exposes every persisted run phase and narration mode', () => {
		expect(runPhaseEnum.enumValues).toEqual([
			'ready',
			'awaiting_loot',
			'awaiting_failure',
			'awaiting_proceed'
		]);
		const phases: RunPhase[] = [...runPhaseEnum.enumValues];
		const modes: TurnNarrationMode[] = ['ordinary_action', 'loot_search', 'failure_consequence'];
		expect(phases).toHaveLength(4);
		expect(modes).toHaveLength(3);
	});

	it('normalizes missing legacy narration modes to ordinary action', () => {
		expect(normalizeNarrationMode()).toBe('ordinary_action');
		expect(normalizeNarrationMode('loot_search')).toBe('loot_search');
		expect(normalizeNarrationMode('failure_consequence')).toBe('failure_consequence');
	});
});

describe('skillPrimary', () => {
	it('maps every skill to the correct primary stat', () => {
		expect(skillPrimary('Athletics')).toBe('body');
		expect(skillPrimary('Stealth')).toBe('body');
		expect(skillPrimary('Knowledge')).toBe('mind');
		expect(skillPrimary('Magic')).toBe('mind');
		expect(skillPrimary('Persuasion')).toBe('spirit');
		expect(skillPrimary('Willpower')).toBe('spirit');
	});
});

describe('deriveStats', () => {
	it('returns base stats with no inventory', () => {
		const stats = deriveStats({
			body: 2,
			mind: 3,
			spirit: 4,
			level: 1,
			hp: 9,
			maxHp: 12
		});
		expect(stats.body).toBe(2);
		expect(stats.mind).toBe(3);
		expect(stats.spirit).toBe(4);
		expect(stats.instinct).toBe(9);
		expect(stats.attackBonus).toBe(9);
		expect(stats.skillValues.Athletics).toBe(2);
		expect(stats.skillValues.Magic).toBe(3);
		expect(stats.skillValues.Willpower).toBe(4);
	});

	it('applies magic gear to primaries up to the gear cap', () => {
		const items: InventoryItem[] = [
			{ kind: 'magic', name: 'A', stat: 'body' },
			{ kind: 'magic', name: 'B', stat: 'body' },
			{ kind: 'magic', name: 'C', stat: 'body' }
		];
		const stats = deriveStats({
			body: 3,
			mind: 3,
			spirit: 3,
			level: 1,
			hp: 10,
			maxHp: 10,
			inventory: items
		});
		expect(stats.body).toBe(6);
	});

	it('caps primary gear contribution at the gear cap', () => {
		const items: InventoryItem[] = Array.from({ length: 9 }, () => ({
			kind: 'magic',
			name: 'x',
			stat: 'body'
		}));
		const stats = deriveStats({
			body: 1,
			mind: 1,
			spirit: 1,
			level: 1,
			hp: 10,
			maxHp: 10,
			inventory: items
		});
		expect(stats.body).toBe(6); // 1 base + cap of 5
	});

	it('applies attack, defense and skill bonuses from gear', () => {
		const items: InventoryItem[] = [
			{ kind: 'magic', name: 'A', stat: 'attack' },
			{ kind: 'magic', name: 'B', stat: 'defense' },
			{ kind: 'magic', name: 'C', stat: 'skill', skill: 'Magic' },
			{ kind: 'draught', name: 'D' }
		];
		const stats = deriveStats({
			body: 3,
			mind: 3,
			spirit: 3,
			level: 1,
			hp: 10,
			maxHp: 10,
			inventory: items
		});
		expect(stats.attackBonus).toBe(10);
		expect(stats.defense).toBe(9);
		expect(stats.skillValues.Magic).toBe(4);
	});

	it('does not add level to Attack', () => {
		const source = { body: 2, mind: 1, spirit: 1, hp: 10, maxHp: 10 };
		expect(deriveStats({ ...source, level: 1 }).attackBonus).toBe(4);
		expect(deriveStats({ ...source, level: 10 }).attackBonus).toBe(4);
	});

	it('adds attribute and general gear exactly once through effective attributes', () => {
		const stats = deriveStats({
			body: 1,
			mind: 1,
			spirit: 1,
			level: 3,
			hp: 10,
			maxHp: 10,
			inventory: [
				{ kind: 'magic', name: 'Body', stat: 'body' },
				{ kind: 'magic', name: 'Mind', stat: 'mind' },
				{ kind: 'magic', name: 'Spirit', stat: 'spirit' },
				{ kind: 'magic', name: 'General', stat: 'general' },
				{ kind: 'magic', name: 'Weapon', stat: 'attack' }
			]
		});
		expect({ body: stats.body, mind: stats.mind, spirit: stats.spirit }).toEqual({
			body: 3,
			mind: 3,
			spirit: 3
		});
		expect(stats.instinct).toBe(9);
		expect(stats.attackBonus).toBe(10);
	});

	it('caps each primary equipment contribution before Attack is summed', () => {
		const inventory: InventoryItem[] = Array.from({ length: 8 }, (_, index) => ({
			kind: 'magic',
			name: `General ${index}`,
			stat: 'general'
		}));
		const stats = deriveStats({
			body: 1,
			mind: 2,
			spirit: 3,
			level: 6,
			hp: 10,
			maxHp: 10,
			inventory
		});
		expect(stats.attackBonus).toBe(21);
	});

	it('uses the corrected Attack value as the combat roll modifier', () => {
		const stats = deriveStats({
			body: 2,
			mind: 1,
			spirit: 1,
			level: 9,
			hp: 10,
			maxHp: 10,
			inventory: [{ kind: 'magic', name: 'Weapon', stat: 'attack' }]
		});
		const encounter = resolve(
			room({ type: 'monster', defense: 99 }),
			{ method: 'combat', advantage: 0 },
			stats
		);
		expect(encounter.rolls[0]?.modifier).toBe(5);
		expect(encounter.rolls[0]?.total).toBe((encounter.rolls[0]?.selected ?? 0) + 5);
	});

	it('stacks multi-effects, caps only primary equipment, and derives Defense from Body', () => {
		const stats = deriveStats({
			body: 2,
			mind: 1,
			spirit: 1,
			level: 4,
			hp: 9,
			maxHp: 9,
			inventory: [
				{
					kind: 'magic',
					name: 'Many-fold plate',
					effects: [
						{ target: 'general', amount: 4 },
						{ target: 'body', amount: 4 },
						{ target: 'attack', amount: 7 },
						{ target: 'defense', amount: 6 },
						{ target: 'skill', skill: 'Athletics', amount: 8 }
					]
				}
			]
		});
		expect(stats.body).toBe(7);
		expect(stats.mind).toBe(5);
		expect(stats.spirit).toBe(5);
		expect(stats.attackBonus).toBe(24);
		expect(stats.defense).toBe(18);
		expect(stats.skillValues.Athletics).toBe(15);
	});
});

describe('deriveStatBreakdowns', () => {
	const input = (inventory: InventoryItem[] = [], gearCap?: number) => ({
		body: 2,
		mind: 3,
		spirit: 1,
		level: 4,
		hp: 8,
		maxHp: 10,
		inventory,
		gearCap
	});

	function expectTotalsMatch(source: ReturnType<typeof input>) {
		const stats = deriveStats(source);
		const breakdowns = deriveStatBreakdowns(source);
		const sum = (parts: { value: number }[]) =>
			parts.reduce((total, part) => total + part.value, 0);

		expect(breakdowns.attributes.body.total).toBe(stats.body);
		expect(breakdowns.attributes.mind.total).toBe(stats.mind);
		expect(breakdowns.attributes.spirit.total).toBe(stats.spirit);
		expect(breakdowns.instinct.total).toBe(stats.instinct);
		expect(breakdowns.attack.total).toBe(stats.attackBonus);
		expect(breakdowns.defense.total).toBe(stats.defense);
		for (const breakdown of [
			...Object.values(breakdowns.attributes),
			...Object.values(breakdowns.skills),
			breakdowns.instinct,
			breakdowns.attack,
			breakdowns.defense
		]) {
			expect(sum(breakdown.parts)).toBe(breakdown.total);
		}
	}

	it('matches every derived total with no gear', () => {
		const source = input();
		expectTotalsMatch(source);
		const breakdowns = deriveStatBreakdowns(source);
		expect(breakdowns.attributes.body.parts.map((part) => part.value)).toEqual([2, 0, 0]);
		expect(breakdowns.defense.parts.map((part) => part.value)).toEqual([5, 2, 0]);
		expect(breakdowns.attack.parts).toEqual([
			{ label: 'Effective Body', value: 2 },
			{ label: 'Effective Mind', value: 3 },
			{ label: 'Effective Spirit', value: 1 },
			{ label: 'Attack equipment', value: 0 }
		]);
		expect(breakdowns.attack.formula).toContain('(Instinct) + Attack equipment');
		expect(breakdowns.instinct.formula).toBe(
			'Effective Body + Effective Mind + Effective Spirit; forms the attribute portion of Attack.'
		);
		expect(breakdowns.instinct.formula).not.toContain('does not drive checks');
	});

	it('aggregates general, attribute, skill, attack and defense gear in authoritative parts', () => {
		const source = input([
			{ kind: 'magic', name: 'General one', stat: 'general' },
			{ kind: 'magic', name: 'General two', stat: 'general' },
			{ kind: 'magic', name: 'Body item', stat: 'body' },
			{ kind: 'magic', name: 'Skill one', stat: 'skill', skill: 'Athletics' },
			{ kind: 'magic', name: 'Skill two', stat: 'skill', skill: 'Athletics' },
			{ kind: 'magic', name: 'Weapon', stat: 'attack' },
			{ kind: 'magic', name: 'Armor', stat: 'defense' }
		]);
		expectTotalsMatch(source);
		const breakdowns = deriveStatBreakdowns(source);
		expect(breakdowns.attributes.body.parts.map((part) => part.value)).toEqual([2, 2, 1]);
		expect(breakdowns.skills.Athletics.parts.map((part) => part.value)).toEqual([5, 2]);
		expect(breakdowns.attack.parts.map((part) => part.value)).toEqual([5, 5, 3, 1]);
		expect(breakdowns.defense.parts.map((part) => part.value)).toEqual([5, 5, 1]);
		// General and Body gear improve Attack exactly once through effective attributes.
		expect(breakdowns.attack.total).toBe(14);
	});

	it('accounts explicitly for primary equipment discarded by the cap', () => {
		const source = input(
			[
				{ kind: 'magic', name: 'General', stat: 'general' },
				{ kind: 'magic', name: 'Body one', stat: 'body' },
				{ kind: 'magic', name: 'Body two', stat: 'body' }
			],
			2
		);
		expectTotalsMatch(source);
		const body = deriveStatBreakdowns(source).attributes.body;
		expect(body.total).toBe(4);
		expect(body.parts).toEqual([
			{ label: 'Body base', value: 2 },
			{ label: 'General equipment', value: 1 },
			{ label: 'Body equipment', value: 2 },
			{ label: 'Gear cap (2)', value: -1 }
		]);
	});
});

describe('per-run stat allocation', () => {
	it('accepts allocations totaling each level from 1 through 9 with a cap of 3', () => {
		for (let level = 1; level <= 9; level++) {
			const body = Math.min(3, level);
			const mind = Math.min(3, level - body);
			const spirit = level - body - mind;
			expect(validateStatAllocation(level, body, mind, spirit)).toBe(true);
		}
	});

	it('rejects invalid levels, fractions, negatives, wrong totals and pre-10 values above 3', () => {
		expect(validateStatAllocation(0, 0, 0, 0)).toBe(false);
		expect(validateStatAllocation(11, 4, 4, 3)).toBe(false);
		expect(validateStatAllocation(3, 1.5, 1, 0.5)).toBe(false);
		expect(validateStatAllocation(3, -1, 2, 2)).toBe(false);
		expect(validateStatAllocation(3, 1, 1, 0)).toBe(false);
		expect(validateStatAllocation(4, 4, 0, 0)).toBe(false);
	});

	it('allows one 4 at level 10, but never two or a value above 4', () => {
		expect(validateStatAllocation(10, 4, 3, 3)).toBe(true);
		expect(validateStatAllocation(10, 3, 3, 4)).toBe(true);
		expect(validateStatAllocation(10, 4, 4, 2)).toBe(false);
		expect(validateStatAllocation(10, 5, 3, 2)).toBe(false);
	});

	it('requires complete valid metadata for new runs', () => {
		expect(
			isValidNewRunMeta({
				startRoom: 5,
				startLevel: 4,
				gearBonus: 2,
				allocatedBody: 2,
				allocatedMind: 1,
				allocatedSpirit: 1
			})
		).toBe(true);
		expect(isValidNewRunMeta({})).toBe(false);
		expect(isValidNewRunMeta({ startRoom: 0, startLevel: 1, gearBonus: 4, allocatedBody: 1 })).toBe(
			false
		);
	});

	it('uses a complete valid allocation and falls back for empty, partial or invalid legacy meta', () => {
		const legacy = { body: 3, mind: 2, spirit: 1 };
		expect(
			resolveRunBaseStats(
				{ startLevel: 4, allocatedBody: 2, allocatedMind: 1, allocatedSpirit: 1 },
				legacy
			)
		).toEqual({ body: 2, mind: 1, spirit: 1 });
		expect(resolveRunBaseStats({}, legacy)).toEqual(legacy);
		expect(resolveRunBaseStats({ startLevel: 4, allocatedBody: 2 }, legacy)).toEqual(legacy);
		expect(
			resolveRunBaseStats(
				{ startLevel: 4, allocatedBody: 4, allocatedMind: 0, allocatedSpirit: 0 },
				legacy
			)
		).toEqual(legacy);
	});
});

describe('persistent progression', () => {
	it('uses the exact level and gear upgrade costs and rejects bounds', () => {
		expect(levelUpgradeCost(2)).toBe(20);
		expect(levelUpgradeCost(10)).toBe(100);
		expect(levelUpgradeCost(1)).toBeNull();
		expect(levelUpgradeCost(11)).toBeNull();
		expect([1, 2, 3].map(gearUpgradeCost)).toEqual([25, 75, 225]);
		expect(gearUpgradeCost(4)).toBeNull();
	});

	it('permits only stat increments that produce a valid next-level allocation', () => {
		expect(canIncreaseStat(1, 1, 0, 0, 'mind')).toBe(true);
		expect(canIncreaseStat(3, 3, 0, 0, 'body')).toBe(false);
		expect(canIncreaseStat(9, 3, 3, 3, 'body')).toBe(true);
		expect(canIncreaseStat(9, 4, 3, 2, 'mind')).toBe(false);
	});

	it('accepts age 1 and rejects ages outside the profile range', () => {
		expect(validCharacterAge(1)).toBe(true);
		expect(validCharacterAge(999)).toBe(true);
		expect(validCharacterAge(0)).toBe(false);
		expect(validCharacterAge(1.5)).toBe(false);
	});

	it('accepts only bounded browser-renderable http image URLs', () => {
		expect(validImageUrl('https://example.com/portrait.jpg')).toBe(true);
		expect(validImageUrl('http://example.com/a.png')).toBe(true);
		expect(validImageUrl('javascript:alert(1)')).toBe(false);
		expect(validImageUrl('https://')).toBe(false);
	});

	it('keeps a valid run snapshot authoritative after mutable character stats change', () => {
		const meta = { startLevel: 2, allocatedBody: 1, allocatedMind: 1, allocatedSpirit: 0 };
		expect(resolveRunBaseStats(meta, { body: 3, mind: 3, spirit: 3 })).toEqual({
			body: 1,
			mind: 1,
			spirit: 0
		});
	});
});

describe('expedition starting loot', () => {
	it('returns the exact cumulative magic rarity loadout for each gear bonus', () => {
		const tiers = ['common', 'uncommon', 'rare', 'very_rare'];
		for (const bonus of [0, 1, 2, 3]) {
			const loot = provisionExpeditionLoot('count', bonus);
			expect(loot).toHaveLength(bonus + 1);
			expect(loot.map((item) => item.rarity)).toEqual(tiers.slice(0, bonus + 1));
			expect(loot.every((item) => item.kind === 'magic')).toBe(true);
		}
	});

	it('rejects non-integer and out-of-range gear bonuses', () => {
		for (const count of [-1, 0.5, 4, Number.NaN]) {
			expect(() => provisionExpeditionLoot('invalid', count)).toThrow(RangeError);
		}
	});

	it('is deterministic for one seed and varies across known seeds', () => {
		const first = provisionExpeditionLoot('alpha', 3);
		expect(provisionExpeditionLoot('alpha', 3)).toEqual(first);
		expect(provisionExpeditionLoot('beta', 3)).not.toEqual(first);
	});

	it('only generates sellable magic items and valuables with no draughts', () => {
		const loot = provisionExpeditionLoot('sale-ready', 3);
		expect(loot.every((item) => item.sellable === true)).toBe(true);
		expect(loot.every((item) => item.source === 'starting')).toBe(true);
		expect(loot.every((item) => item.kind === 'magic' || item.kind === 'valuable')).toBe(true);
		expect(loot.some((item) => item.kind === 'draught')).toBe(false);
		expect(loot.every((item) => settlementGold([item], 'settle', 1, 0) > 0)).toBe(true);
	});

	it('applies generated magic loot through normal inventory stat derivation', () => {
		const loot = provisionExpeditionLoot('alpha', 1);
		expect(loot[0].kind).toBe('magic');
		const input = { body: 1, mind: 1, spirit: 1, level: 3, hp: 8, maxHp: 8 };
		expect(deriveStats({ ...input, inventory: loot })).not.toEqual(deriveStats(input));
	});

	it('leaves room generation unchanged for a known seed', () => {
		const input = {
			seed: 'starting-loot-isolation',
			room: 3,
			turn: 0,
			monsters: [],
			traps: []
		};
		const before = generateRoom(input);
		provisionExpeditionLoot(input.seed, 3);
		expect(generateRoom(input)).toEqual(before);
	});
});

describe('abandonSettlementGold', () => {
	const starting = (name: string): InventoryItem => ({
		kind: 'valuable',
		name,
		source: 'starting'
	});
	const unmarked = (name: string): InventoryItem => ({ kind: 'valuable', name });

	it('pays nothing for an immediate abandon holding only starting loot', () => {
		expect(abandonSettlementGold([starting('A')], 'ab', 1, 0)).toBe(0);
	});

	it('still sells nonstarting items in a mixed immediate abandon', () => {
		const mixed = [starting('A'), unmarked('B')];
		const gold = abandonSettlementGold(mixed, 'ab', 1, 0);
		expect(gold).toBeGreaterThan(0);
		expect(gold).toBe(settlementGold([unmarked('B')], 'ab', 1, 0));
	});

	it('sells starting loot once a player turn has resolved', () => {
		const item = starting('A');
		expect(abandonSettlementGold([item], 'ab', 1, 1)).toBe(settlementGold([item], 'ab', 1, 1));
		expect(abandonSettlementGold([item], 'ab', 1, 1)).toBeGreaterThan(0);
	});

	it('sells starting loot in a fatal settlement after an action', () => {
		const item = starting('A');
		expect(settlementGold([item], 'fatal', 2, 1)).toBeGreaterThan(0);
	});

	it('leaves historical unmarked items selling unchanged on immediate abandon', () => {
		const item = unmarked('A');
		expect(abandonSettlementGold([item], 'ab', 1, 0)).toBe(settlementGold([item], 'ab', 1, 0));
	});
});

describe('checkedCompanyGoldAdd', () => {
	it('returns the exact safe sum at the boundary of the safe range', () => {
		expect(checkedCompanyGoldAdd(0, 0)).toBe(0);
		expect(checkedCompanyGoldAdd(1, MAX_COMPANY_GOLD - 1)).toBe(MAX_COMPANY_GOLD);
		expect(checkedCompanyGoldAdd(MAX_COMPANY_GOLD, 0)).toBe(MAX_COMPANY_GOLD);
	});

	it('rejects a sum that would exceed the safe range', () => {
		expect(() => checkedCompanyGoldAdd(MAX_COMPANY_GOLD, 1)).toThrow(
			new RegExp(`exceeds the safe limit ${MAX_COMPANY_GOLD}`)
		);
		expect(() => checkedCompanyGoldAdd(MAX_COMPANY_GOLD - 1, 2)).toThrow();
	});

	it('rejects negative inputs', () => {
		expect(() => checkedCompanyGoldAdd(-1, 5)).toThrow(
			/Company gold must be a nonnegative safe integer/
		);
		expect(() => checkedCompanyGoldAdd(5, -1)).toThrow(
			/Settlement gold must be a nonnegative safe integer/
		);
	});

	it('rejects non-integer inputs', () => {
		expect(() => checkedCompanyGoldAdd(1.5, 5)).toThrow(
			/Company gold must be a nonnegative safe integer/
		);
		expect(() => checkedCompanyGoldAdd(5, 2.5)).toThrow(
			/Settlement gold must be a nonnegative safe integer/
		);
	});
});

describe('generateRoom', () => {
	it('makes every positive multiple of five a boss room', () => {
		for (let roomNumber = 1; roomNumber <= 40; roomNumber++) {
			const snapshot = generateRoom({
				seed: 'boss-scan',
				room: roomNumber,
				turn: 1,
				monsters: [],
				traps: []
			});
			if (roomNumber % 5 === 0) {
				expect(snapshot.type).toBe('boss');
				expect(snapshot.boss).toBe(true);
			} else {
				expect(snapshot.type).not.toBe('boss');
			}
		}
	});

	it('adds the boss target bonus to the chosen monster defense', () => {
		const snapshot = generateRoom({ seed: 'boss-def', room: 5, turn: 1, monsters: [], traps: [] });
		expect(snapshot.type).toBe('boss');
		const rng = createRng('boss-def', 5, 1, 'room');
		const index = Math.floor(rng.next() * FALLBACK_MONSTERS.length);
		expect(snapshot.defense).toBe(FALLBACK_MONSTERS[index].defense + BOSS_TARGET_BONUS);
	});

	it('gives boss rooms a double-size reward pool', () => {
		const snapshot = generateRoom({
			seed: 'boss-pool',
			room: 10,
			turn: 1,
			monsters: [],
			traps: []
		});
		expect(snapshot.rewards).toHaveLength(6);
	});

	it('only produces monster, trap, treasure or rest for non-boss rooms', () => {
		const allowed = new Set(['monster', 'trap', 'treasure', 'rest']);
		for (let roomNumber = 1; roomNumber <= 60; roomNumber++) {
			if (roomNumber % 5 === 0) continue;
			const snapshot = generateRoom({
				seed: 'kind-scan',
				room: roomNumber,
				turn: 1,
				monsters: [],
				traps: []
			});
			expect(allowed.has(snapshot.type)).toBe(true);
		}
	});

	it('computes trap DC as 5 + floor(room / 5)', () => {
		for (let roomNumber = 1; roomNumber <= 120; roomNumber++) {
			const snapshot = generateRoom({
				seed: 'trap-dc',
				room: roomNumber,
				turn: 1,
				monsters: [],
				traps: []
			});
			if (snapshot.type === 'trap') {
				expect(snapshot.dc).toBe(TRAP_DC_BASE + Math.floor(roomNumber / 5));
				expect(snapshot.skill).toBeDefined();
			}
		}
	});

	it('uses provided definitions when present', () => {
		const snapshot = generateRoom({
			seed: 'custom',
			room: 2,
			turn: 1,
			monsters: [
				{ id: 'm', name: 'Custom Horror', tier: 1, hp: 5, defense: 7, temperament: 'testy' }
			],
			traps: []
		});
		if (snapshot.type === 'monster') {
			expect(snapshot.name).toBe('Custom Horror');
			expect(snapshot.defense).toBe(7);
		}
	});

	it('snapshots normal and debauched editor-authored monster descriptions', () => {
		const monster = {
			id: 'm',
			name: 'Custom Horror',
			tier: 1,
			hp: 5,
			defense: 7,
			temperament: 'testy',
			description: 'The normal authored description.',
			debauchedDescription: 'The alternate authored description.'
		};
		const normal = generateRoom({
			seed: 'authored',
			room: 5,
			turn: 1,
			debauchery: 1,
			monsters: [monster],
			traps: []
		});
		const alternate = generateRoom({
			seed: 'authored',
			room: 5,
			turn: 1,
			debauchery: 2,
			monsters: [monster],
			traps: []
		});
		expect(normal.description).toBe(monster.description);
		expect(alternate.description).toBe(`${monster.description}\n\n${monster.debauchedDescription}`);
	});

	it('uses a debauched-only description for adult monster rooms', () => {
		const snapshot = generateRoom({
			seed: 'debauched-only',
			room: 5,
			turn: 1,
			debauchery: 2,
			monsters: [
				{
					id: 'm',
					name: 'Custom Horror',
					tier: 1,
					hp: 5,
					defense: 7,
					temperament: 'testy',
					description: ' ',
					debauchedDescription: 'Adult authored description.'
				}
			],
			traps: []
		});
		expect(snapshot.description).toBe('Adult authored description.');
	});

	it('uses deterministic boss fallback when both authored descriptions are blank', () => {
		const snapshot = generateRoom({
			seed: 'blank-boss',
			room: 5,
			turn: 1,
			debauchery: 2,
			monsters: [
				{
					id: 'm',
					name: 'Custom Horror',
					tier: 1,
					hp: 5,
					defense: 7,
					temperament: 'testy',
					description: '',
					debauchedDescription: ''
				}
			],
			traps: []
		});
		expect(snapshot.type).toBe('boss');
		expect(snapshot.description).toContain('Custom Horror');
	});

	it('falls back to the normal monster description when the alternate is blank', () => {
		const snapshot = generateRoom({
			seed: 'blank-alternate',
			room: 5,
			turn: 1,
			debauchery: 5,
			monsters: [
				{
					id: 'm',
					name: 'Custom Horror',
					tier: 1,
					hp: 5,
					defense: 7,
					temperament: 'testy',
					description: 'The normal authored description.',
					debauchedDescription: '   '
				}
			],
			traps: []
		});
		expect(snapshot.description).toBe('The normal authored description.');
	});

	it('snapshots editor-authored trap descriptions', () => {
		let snapshot: RoomSnapshot | undefined;
		for (let roomNumber = 1; roomNumber < 100 && snapshot?.type !== 'trap'; roomNumber++) {
			if (roomNumber % 5 === 0) continue;
			const candidate = generateRoom({
				seed: 'authored-trap',
				room: roomNumber,
				turn: 1,
				monsters: [],
				traps: [
					{
						id: 't',
						name: 'Custom Trap',
						tier: 1,
						target: 8,
						skill: 'Knowledge',
						consequence: 'A consequence',
						description: 'The authored trap description.'
					}
				]
			});
			if (candidate.type === 'trap') snapshot = candidate;
		}
		expect(snapshot?.description).toBe('The authored trap description.');
	});

	it('is deterministic for identical inputs', () => {
		const a = generateRoom({ seed: 'det', room: 3, turn: 1, monsters: [], traps: [] });
		const b = generateRoom({ seed: 'det', room: 3, turn: 1, monsters: [], traps: [] });
		expect(a).toEqual(b);
	});
});

describe('resolveEncounter', () => {
	it('defeats a monster on a successful combat roll', () => {
		const result = resolve(
			room({ type: 'monster', defense: 8 }),
			{ method: 'combat', advantage: 0 },
			baseStats({ attackBonus: 100 })
		);
		expect(result.outcome.result).toBe('reward');
		expect(result.outcome.hpDelta).toBe(0);
		expect(result.rolls).toHaveLength(1);
	});

	it('loses 1 HP when combat fails', () => {
		const result = resolve(
			room({ type: 'monster', defense: 8 }),
			{ method: 'combat', advantage: 0 },
			baseStats({ attackBonus: -100 }),
			7
		);
		expect(result.outcome.result).toBe('failure');
		expect(result.outcome.hpAfter).toBe(6);
		expect(result.outcome.hpDelta).toBe(-1);
	});

	it('defers boss rewards until post-encounter loot resolution', () => {
		const rewards: InventoryItem[] = [
			{ kind: 'magic', name: 'M1', stat: 'attack' },
			{ kind: 'magic', name: 'M2', stat: 'defense' }
		];
		const result = resolve(
			room({ type: 'boss', defense: 10, rewards }),
			{ method: 'combat', advantage: 0 },
			baseStats({ attackBonus: 100 })
		);
		expect(result.outcome.result).toBe('reward');
		expect(result.outcome.rewards).toBeUndefined();
	});

	it('lets a skill approach slip past a monster', () => {
		const stats = baseStats({ skillValues: { ...baseStats().skillValues, Stealth: 100 } });
		const result = resolve(
			room({ type: 'monster', defense: 8 }),
			{ method: 'skill', skill: 'Stealth', advantage: 0 },
			stats
		);
		expect(result.outcome.result).toBe('reward');
		expect(result.outcome.hpDelta).toBe(0);
	});

	it('fails a trap check and loses 1 HP', () => {
		const stats = baseStats({ skillValues: { ...baseStats().skillValues, Knowledge: 0 } });
		const result = resolve(
			room({ type: 'trap', dc: 20, skill: 'Knowledge' }),
			{ method: 'skill', skill: 'Knowledge', advantage: 0 },
			stats,
			5
		);
		expect(result.outcome.result).toBe('failure');
		expect(result.outcome.hpAfter).toBe(4);
	});

	it('reaches defeat when HP drops to zero', () => {
		const stats = baseStats({ skillValues: { ...baseStats().skillValues, Knowledge: 0 } });
		const result = resolve(
			room({ type: 'trap', dc: 20, skill: 'Knowledge' }),
			{ method: 'skill', skill: 'Knowledge', advantage: 0 },
			stats,
			1
		);
		expect(result.outcome.result).toBe('defeat');
		expect(result.outcome.hpAfter).toBe(0);
	});

	it('draws one reward from a treasure room', () => {
		const rewards: InventoryItem[] = [{ kind: 'valuable', name: 'Gilded Crown' }];
		const result = resolve(room({ type: 'treasure', rewards }), { method: 'none', advantage: 0 });
		expect(result.outcome.result).toBe('reward');
		expect(result.outcome.rewards).toEqual(rewards);
	});

	it('never checks or harms the hero when claiming treasure with another method', () => {
		const rewards: InventoryItem[] = [{ kind: 'valuable', name: 'Gilded Crown' }];
		const result = resolve(
			room({ type: 'treasure', rewards, dc: 100 }),
			{ method: 'combat', advantage: -2 },
			baseStats({ attackBonus: -100 }),
			1
		);
		expect(result.rolls).toEqual([]);
		expect(result.outcome.result).toBe('reward');
		expect(result.outcome.hpAfter).toBe(1);
		expect(result.outcome.rewards).toEqual(rewards);
	});

	it('consumes an immediate healing draught for HP', () => {
		const rewards: InventoryItem[] = [{ kind: 'draught', name: 'Draught of Rest' }];
		const result = resolve(
			room({ type: 'treasure', rewards }),
			{ method: 'none', advantage: 0 },
			baseStats(),
			5,
			10
		);
		expect(result.outcome.result).toBe('reward');
		expect(result.outcome.hpAfter).toBe(6);
		expect(result.outcome.rewards).toEqual(rewards);
		expect(result.outcome.carriedRewards).toEqual([]);
	});

	it('records immediate treasure maximum-HP changes in the authoritative outcome', () => {
		const draught: InventoryItem = {
			kind: 'draught',
			name: 'Draught of Ascension',
			rarity: 'artifact',
			maxHpIncrease: 5,
			fullHeal: true,
			value: 0
		};
		const result = resolve(
			room({ type: 'treasure', rewards: [draught] }),
			{ method: 'none', advantage: 0 },
			baseStats(),
			3,
			10
		);
		expect(result.outcome).toMatchObject({
			hpBefore: 3,
			hpAfter: 15,
			hpDelta: 12,
			maxHpBefore: 10,
			maxHpAfter: 15,
			maxHpDelta: 5
		});
	});

	it('rests and recovers 1 HP', () => {
		const result = resolve(
			room({ type: 'rest' }),
			{ method: 'none', advantage: 0 },
			baseStats(),
			5,
			10
		);
		expect(result.outcome.result).toBe('rest');
		expect(result.outcome.hpAfter).toBe(6);
	});
});

describe('mapActionIntent', () => {
	it('detects combat from text', () => {
		expect(mapActionIntent({ text: 'I strike the goblin hard' }).approach).toBe('combat');
	});

	it('detects a skill from text', () => {
		const mapped = mapActionIntent({ text: 'I sneak past the sentry' });
		expect(mapped.approach).toBe('skill');
		expect(mapped.skill).toBe('Stealth');
	});

	it('honours an explicit method and skill', () => {
		const mapped = mapActionIntent({ method: 'skill', skill: 'Magic', text: 'I attack' });
		expect(mapped.approach).toBe('skill');
		expect(mapped.skill).toBe('Magic');
	});

	it('clamps advantage into -2..2', () => {
		expect(mapActionIntent({ text: 'attack', advantage: 9 }).advantage).toBe(2);
		expect(mapActionIntent({ text: 'attack', advantage: -9 }).advantage).toBe(-2);
	});

	it('converts to the persisted TurnIntent shape', () => {
		const turn: TurnIntent = toTurnIntent({ approach: 'skill', skill: 'Persuasion', advantage: 1 });
		expect(turn.method).toBe('skill');
		expect(turn.skill).toBe('Persuasion');
		expect(turn.advantage).toBe(1);
	});

	it('maps treasure claim actions to no-check intent', () => {
		const mapped = mapActionIntent({
			text: 'I claim the treasure.',
			room: room({ type: 'treasure' })
		});
		expect(mapped).toEqual({ approach: 'none', advantage: 0 });
	});

	it('does not accept none without an authoritative no-check room', () => {
		expect(mapActionIntent({ method: 'none' })).toEqual({ approach: 'combat', advantage: 0 });
	});

	it('normalizes model-supplied none according to the authoritative room', () => {
		expect(
			normalizeActionIntent(room({ type: 'monster' }), { approach: 'none', advantage: 1 })
		).toEqual({ approach: 'combat', advantage: 1 });
		expect(
			normalizeActionIntent(room({ type: 'boss' }), { approach: 'none', advantage: 0 })
		).toEqual({ approach: 'combat', advantage: 0 });
		expect(
			normalizeActionIntent(room({ type: 'trap', skill: 'Magic' }), {
				approach: 'none',
				advantage: -1
			})
		).toEqual({ approach: 'skill', skill: 'Magic', advantage: -1 });
	});

	it('normalizes treasure and rest approaches to none', () => {
		expect(
			normalizeActionIntent(room({ type: 'treasure' }), { approach: 'combat', advantage: 0 })
		).toEqual({ approach: 'none', advantage: 0 });
		expect(
			normalizeActionIntent(room({ type: 'rest' }), {
				approach: 'skill',
				skill: 'Stealth',
				advantage: 0
			})
		).toEqual({ approach: 'none', advantage: 0 });
	});
});

describe('sellValue', () => {
	it('sells magic for 1d2, valuable for 1d6 and draught for nothing', () => {
		const rng = createRng('sell', 1, 1, 'sell');
		const magic = sellValue({ kind: 'magic', name: 'M', stat: 'attack' }, rng);
		expect(magic).toBeGreaterThanOrEqual(1);
		expect(magic).toBeLessThanOrEqual(2);
		const valuable = sellValue({ kind: 'valuable', name: 'V' }, rng);
		expect(valuable).toBeGreaterThanOrEqual(1);
		expect(valuable).toBeLessThanOrEqual(6);
		expect(sellValue({ kind: 'draught', name: 'D' }, rng)).toBe(0);
	});

	it('returns 0 for a draught with fixed value or dice and draws no RNG', () => {
		let draws = 0;
		const rng: Rng = {
			next: () => 0,
			d10: () => 1,
			range: (min) => {
				draws += 1;
				return min;
			},
			pick: (items) => items[0],
			weighted: (items) => items[0]
		};
		const draught: InventoryItem = {
			kind: 'draught',
			name: 'Fixed draught',
			value: 9,
			valueDice: { count: 6, sides: 6 }
		};
		expect(sellValue(draught, rng)).toBe(0);
		expect(draws).toBe(0);
	});
});

describe('generateRewardPool', () => {
	it('produces equal thirds of magic, draught and valuable', () => {
		const rng = createRng('pool', 1, 1, 'pool');
		const pool = generateRewardPool(rng, 6);
		expect(pool).toHaveLength(6);
		const kinds = pool.map((item) => item.kind);
		expect(kinds.filter((k) => k === 'magic')).toHaveLength(2);
		expect(kinds.filter((k) => k === 'draught')).toHaveLength(2);
		expect(kinds.filter((k) => k === 'valuable')).toHaveLength(2);
	});
});

describe('post-encounter loot foundation', () => {
	const magic: InventoryItem = { kind: 'magic', name: 'Blade', stat: 'attack' };
	const draught: InventoryItem = { kind: 'draught', name: 'Draught' };
	const valuable: InventoryItem = { kind: 'valuable', name: 'Idol' };

	it('preserves an existing pool by reference and deterministically fills legacy encounter rooms', () => {
		const existing = room({ type: 'monster', rewards: [valuable] });
		expect(ensureEncounterRewardPool(existing, 'seed', 7)).toBe(existing);

		const legacy = room({ type: 'trap' });
		const first = ensureEncounterRewardPool(legacy, 'seed', 7);
		const retry = ensureEncounterRewardPool(legacy, 'seed', 7);
		expect(first).toEqual(retry);
		expect(first.rewards).toHaveLength(3);
		expect(legacy.rewards).toBeUndefined();
	});

	it('creates normal encounter pools during room generation', () => {
		for (let number = 1; number < 40; number++) {
			if (number % 5 === 0) continue;
			const generated = generateRoom({
				seed: 'all-pools',
				room: number,
				turn: 91,
				monsters: [],
				traps: []
			});
			if (generated.type === 'monster' || generated.type === 'trap') {
				expect(generated.rewards).toHaveLength(3);
			}
		}
	});

	it('draws deterministically without mutating the pool or depending on encounter approach', () => {
		const encounter = room({ type: 'monster', rewards: [magic, draught, valuable] });
		const before = structuredClone(encounter);
		const first = drawEncounterLoot(encounter, 'stable', 11);
		const retry = drawEncounterLoot(encounter, 'stable', 11);
		expect(first).toEqual(retry);
		expect(first.drawn).toHaveLength(1);
		expect(encounter).toEqual(before);
		// No combat/skill or client action key enters the draw API or seed tuple.
		expect(drawEncounterLoot(encounter, 'stable', 11)).toEqual(first);
	});

	it('draws two boss items and separates consumed draughts from carried rewards', () => {
		const boss = room({ type: 'boss', rewards: [draught, draught, magic, valuable] });
		const draw = drawEncounterLoot(boss, 'boss', 10);
		expect(draw.drawn).toHaveLength(2);
		expect(draw.carried.every((item) => item.kind !== 'draught')).toBe(true);
		expect(draw.consumedDraughtCount).toBe(draw.consumedDraughts.length);
	});

	it('applies multiple draughts with capped healing and preserves carried gear effects', () => {
		const applied = applyLoot([], 8, 10, { carried: [magic], consumedDraughtCount: 3 });
		expect(applied).toEqual({
			inventory: [magic],
			hpAfter: 10,
			hpDelta: 2,
			maxHpAfter: 10,
			maxHpDelta: 0
		});
		expect(
			deriveStats({
				body: 1,
				mind: 0,
				spirit: 0,
				level: 1,
				hp: applied.hpAfter,
				maxHp: 10,
				inventory: applied.inventory
			}).attackBonus
		).toBe(2);
		expect(applyLoot([], 10, 10, { carried: [], consumedDraughtCount: 1 }).hpDelta).toBe(0);
	});

	it('normalizes legacy carried rewards and classifies encounter outcomes', () => {
		const legacy = normalizeTurnOutcome({
			result: 'reward',
			hpBefore: 5,
			hpAfter: 5,
			hpDelta: 0,
			message: 'found',
			rewards: [magic, draught, valuable]
		});
		expect(legacy.carriedRewards).toEqual([magic, valuable]);
		expect(classifyEncounterOutcome(legacy)).toBe('success');
		expect(classifyEncounterOutcome({ ...legacy, result: 'failure' })).toBe('failure');
		expect(classifyEncounterOutcome({ ...legacy, result: 'defeat', hpAfter: 0 })).toBe('fatal');
	});
});

describe('canonical loot normalization', () => {
	it('normalizes legacy gear and values without mutating the source', () => {
		const source: InventoryItem = { kind: 'magic', name: 'Old ward', stat: 'defense' };
		const before = structuredClone(source);
		expect(normalizeInventoryItem(source)).toMatchObject({
			rarity: 'common',
			effects: [{ target: 'defense', amount: 1 }],
			valueDice: { count: 1, sides: 2 }
		});
		expect(source).toEqual(before);
	});

	it('keeps valid explicit effects authoritative and ignores malformed data safely', () => {
		const malformed = {
			kind: 'magic',
			name: 'Oddity',
			stat: 'attack',
			rarity: 'mythic',
			effects: [
				{ target: 'body', amount: 2 },
				{ target: 'skill', amount: 2 },
				{ target: 'mind', amount: 0 }
			],
			valueDice: { count: 0, sides: 6 }
		} as unknown as InventoryItem;
		expect(normalizeInventoryItem(malformed)).toMatchObject({
			rarity: 'common',
			effects: [{ target: 'body', amount: 2 }],
			valueDice: { count: 1, sides: 2 }
		});
	});

	it('gives fixed nonnegative value precedence over explicit dice', () => {
		const item: InventoryItem = {
			kind: 'valuable',
			name: 'Known coin',
			value: 7,
			valueDice: { count: 6, sides: 6 }
		};
		expect(normalizeInventoryItem(item)).toMatchObject({ value: 7, valueDice: undefined });
	});

	it('ignores fractional, unsafe and negative fixed values and falls through to dice', () => {
		const badValue = (value: unknown): InventoryItem =>
			({ kind: 'valuable', name: 'Bad value', value }) as unknown as InventoryItem;
		const fallback = { value: undefined, valueDice: { count: 1, sides: 6 } };
		expect(normalizeInventoryItem(badValue(1.5))).toMatchObject(fallback);
		expect(normalizeInventoryItem(badValue(-3))).toMatchObject(fallback);
		expect(normalizeInventoryItem(badValue(Number.MAX_SAFE_INTEGER + 1))).toMatchObject(fallback);
		expect(normalizeInventoryItem(badValue(Number.NaN))).toMatchObject(fallback);
	});

	it('ignores huge, fractional and invalid dice without long loops', () => {
		const badDice = (valueDice: unknown): InventoryItem =>
			({ kind: 'valuable', name: 'Bad dice', valueDice }) as unknown as InventoryItem;
		const fallback = { valueDice: { count: 1, sides: 6 } };
		expect(normalizeInventoryItem(badDice({ count: 1_000_000, sides: 6 }))).toMatchObject(fallback);
		expect(normalizeInventoryItem(badDice({ count: 1.5, sides: 6 }))).toMatchObject(fallback);
		expect(normalizeInventoryItem(badDice({ count: 0, sides: 6 }))).toMatchObject(fallback);
		expect(normalizeInventoryItem(badDice({ count: 3, sides: 1 }))).toMatchObject(fallback);
		expect(normalizeInventoryItem(badDice({ count: 3, sides: 1000 }))).toMatchObject(fallback);
		expect(
			normalizeInventoryItem(badDice({ count: Number.MAX_SAFE_INTEGER + 1, sides: 6 }))
		).toMatchObject(fallback);
	});

	it('formats dice and effect summaries', () => {
		expect(formatDice({ count: 3, sides: 8 })).toBe('3d8');
		expect(
			formatItemEffects([
				{ target: 'attack', amount: 3 },
				{ target: 'skill', skill: 'Magic', amount: 1 }
			])
		).toBe('attack +3, Magic +1');
	});
});

describe('rarity generation tables', () => {
	const rarities: ItemRarity[] = [
		'common',
		'uncommon',
		'rare',
		'very_rare',
		'legendary',
		'artifact'
	];
	const rows = [
		{ depth: 1, weights: [70, 25, 5, 0, 0, 0] },
		{ depth: 4, weights: [70, 25, 5, 0, 0, 0] },
		{ depth: 5, weights: [55, 30, 12, 3, 0, 0] },
		{ depth: 10, weights: [40, 30, 20, 8, 2, 0] },
		{ depth: 20, weights: [25, 30, 25, 14, 5, 1] },
		{ depth: 35, weights: [15, 25, 25, 20, 12, 3] },
		{ depth: 50, weights: [10, 20, 25, 22, 16, 7] }
	];

	function thresholdRng(value: number): Rng {
		const next = () => value;
		return {
			next,
			d10: () => 1,
			range: (min) => min,
			pick: (items) => items[0],
			weighted: (items) => {
				let roll = value * items.reduce((sum, item) => sum + item.weight, 0);
				for (const item of items) {
					roll -= item.weight;
					if (roll < 0) return item;
				}
				return items[items.length - 1];
			}
		};
	}

	it('uses every exact depth-boundary weight row', () => {
		for (const row of rows) {
			for (let bucket = 0; bucket < 100; bucket++) {
				let cursor = bucket;
				const expected = rarities[row.weights.findIndex((weight) => (cursor -= weight) < 0)];
				expect(selectLootRarity(thresholdRng((bucket + 0.5) / 100), row.depth)).toBe(expected);
			}
		}
	});

	it('generates exact magic and valuable dice with legal distinct effect sets', () => {
		const dice = ['1d2', '2d2', '2d4', '2d6', '3d8', '4d10'];
		for (const [index, rarity] of rarities.entries()) {
			const magic = generateMagicItem(createRng('magic', index, 0, rarity), rarity);
			expect(formatDice(magic.valueDice!)).toBe(dice[index]);
			expect(new Set(magic.effects!.map((item) => item.target)).size).toBe(magic.effects!.length);
			expect(magic.description).toContain(formatItemEffects(magic.effects!));
			const valuable = generateValuable(createRng('valuable', index, 0, rarity), rarity);
			expect(valuable.valueDice).toEqual({ count: index + 1, sides: 6 });
		}
		expect(generateMagicItem(createRng('artifact', 1, 1, 'a'), 'artifact').effects).toEqual([
			{ target: 'body', amount: 1 },
			{ target: 'mind', amount: 1 },
			{ target: 'spirit', amount: 1 },
			{ target: 'attack', amount: 3 },
			{ target: 'defense', amount: 3 }
		]);
	});
});

describe('rarity draught vitality', () => {
	const rarities: ItemRarity[] = [
		'common',
		'uncommon',
		'rare',
		'very_rare',
		'legendary',
		'artifact'
	];

	it('applies every generated draught table entry', () => {
		for (let rank = 0; rank < 4; rank++) {
			const draught = generateDraught(createRng('drink', rank, 0, 'd'), rarities[rank]);
			const applied = applyLoot([], 9, 10, { consumedDraughts: [draught] });
			expect(applied.hpAfter).toBe(9 + rank + 1);
			expect(applied.maxHpAfter).toBe(10 + rank);
		}
		for (const [rarity, increase] of [
			['legendary', 4],
			['artifact', 5]
		] as const) {
			const applied = applyLoot([], 2, 10, {
				consumedDraughts: [generateDraught(createRng('drink', increase, 0, 'd'), rarity)]
			});
			expect(applied).toMatchObject({ hpAfter: 10 + increase, maxHpAfter: 10 + increase });
		}
	});

	it('retains legacy capped heal-one behavior and applies mixed draughts in order', () => {
		expect(
			applyLoot([], 10, 10, { consumedDraughts: [{ kind: 'draught', name: 'Old' }] })
		).toMatchObject({
			hpAfter: 10,
			maxHpAfter: 10
		});
		const applied = applyLoot([], 10, 10, {
			consumedDraughts: [
				generateDraught(createRng('order', 1, 0, 'd'), 'common'),
				generateDraught(createRng('order', 2, 0, 'd'), 'legendary')
			]
		});
		expect(applied).toMatchObject({ hpAfter: 15, maxHpAfter: 15, hpDelta: 5, maxHpDelta: 5 });
	});
});

describe('settlement compatibility and RNG stability', () => {
	it('does not draw for unsellable or fixed-value items and rolls explicit dice count times', () => {
		let draws = 0;
		const rng: Rng = {
			next: () => 0,
			d10: () => 1,
			range: (min) => {
				draws += 1;
				return min;
			},
			pick: (items) => items[0],
			weighted: (items) => items[0]
		};
		expect(sellValue({ kind: 'valuable', name: 'No', sellable: false }, rng)).toBe(0);
		expect(sellValue({ kind: 'valuable', name: 'Fixed', value: 9 }, rng)).toBe(9);
		expect(draws).toBe(0);
		expect(
			sellValue({ kind: 'valuable', name: 'Dice', valueDice: { count: 3, sides: 6 } }, rng)
		).toBe(3);
		expect(draws).toBe(3);
	});

	it('sells huge and fractional dice as a single legacy draw instead of looping', () => {
		let draws = 0;
		const rng: Rng = {
			next: () => 0,
			d10: () => 1,
			range: (min) => {
				draws += 1;
				return min;
			},
			pick: (items) => items[0],
			weighted: (items) => items[0]
		};
		const huge: InventoryItem = {
			kind: 'valuable',
			name: 'Huge dice',
			valueDice: { count: 1_000_000, sides: 6 }
		};
		const fractional: InventoryItem = {
			kind: 'valuable',
			name: 'Fractional dice',
			valueDice: { count: 2.5, sides: 6 }
		};
		expect(sellValue(huge, rng)).toBe(1);
		expect(sellValue(fractional, rng)).toBe(1);
		expect(draws).toBe(2);
	});
});

describe('rules-version reward compatibility', () => {
	it('keeps explicit empty rewards immutable and synthesizes deterministic legacy pools', () => {
		const empty = room({ type: 'monster', rewards: [] });
		expect(ensureEncounterRewardPool(empty, 'v3', 8, 3)).toBe(empty);
		const legacy = ensureEncounterRewardPool(room({ type: 'monster' }), 'v2', 8, 2);
		expect(legacy.rewards).toHaveLength(3);
		expect(legacy.rewards!.every((item) => item.rarity === undefined)).toBe(true);
		expect(ensureEncounterRewardPool(room({ type: 'monster' }), 'v2', 8, 2)).toEqual(legacy);
	});
});
