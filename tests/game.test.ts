import { describe, it, expect } from 'vitest';
import {
	BOSS_TARGET_BONUS,
	FALLBACK_MONSTERS,
	MAX_COMPANY_GOLD,
	TRAP_DC_BASE,
	checkedCompanyGoldAdd,
	applyLoot,
	classifyEncounterOutcome,
	deriveStatBreakdowns,
	deriveStats,
	canIncreaseStat,
	gearUpgradeCost,
	generateRewardPool,
	generateRoom,
	drawEncounterLoot,
	ensureEncounterRewardPool,
	isValidNewRunMeta,
	levelUpgradeCost,
	mapActionIntent,
	normalizeActionIntent,
	normalizeNarrationMode,
	normalizeTurnOutcome,
	resolveEncounter,
	resolveRunBaseStats,
	provisionPersistentGear,
	settlementGold,
	sellValue,
	skillPrimary,
	toTurnIntent,
	validateStatAllocation,
	validCharacterAge,
	validImageUrl
} from '../src/lib/server/game';
import { createRng } from '../src/lib/server/rng';
import { runPhaseEnum } from '../src/lib/server/schema';
import type {
	DerivedStats,
	InventoryItem,
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
			maxHp: 12,
			defense: 9,
			attackBonus: 1
		});
		expect(stats.body).toBe(2);
		expect(stats.mind).toBe(3);
		expect(stats.spirit).toBe(4);
		expect(stats.instinct).toBe(9);
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
			defense: 10,
			attackBonus: 1,
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
			defense: 10,
			attackBonus: 1,
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
			defense: 10,
			attackBonus: 1,
			inventory: items
		});
		expect(stats.attackBonus).toBe(2);
		expect(stats.defense).toBe(11);
		expect(stats.skillValues.Magic).toBe(4);
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
		defense: 9,
		attackBonus: 6,
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
		expect(breakdowns.defense.parts.map((part) => part.value)).toEqual([5, 4, 0]);
		expect(breakdowns.attack.parts.map((part) => part.value)).toEqual([2, 4, 0]);
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
		expect(breakdowns.attack.parts.map((part) => part.value)).toEqual([2, 4, 1]);
		expect(breakdowns.defense.parts.map((part) => part.value)).toEqual([5, 4, 1]);
		// General and Body gear improve skills through effective Body, never authoritative Attack.
		expect(breakdowns.attack.total).toBe(7);
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

	it('materializes non-sellable persistent gear and excludes it from defeat or abandon settlement', () => {
		const gear = provisionPersistentGear(2);
		expect(gear.every((item) => item.sellable === false)).toBe(true);
		const inventory: InventoryItem[] = [...gear, { kind: 'valuable', name: 'Sellable prize' }];
		const withGear = settlementGold(inventory, 'run', 5, 2);
		const prizeOnly = settlementGold([inventory[2]], 'run', 5, 2);
		expect(withGear).toBe(prizeOnly);
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
		expect(applied).toEqual({ inventory: [magic], hpAfter: 10, hpDelta: 2 });
		expect(
			deriveStats({
				body: 1,
				mind: 0,
				spirit: 0,
				level: 1,
				hp: applied.hpAfter,
				maxHp: 10,
				defense: 6,
				attackBonus: 2,
				inventory: applied.inventory
			}).attackBonus
		).toBe(3);
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
