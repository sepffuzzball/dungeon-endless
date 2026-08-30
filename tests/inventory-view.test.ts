import { describe, expect, it } from 'vitest';
import { toInventoryViewItem } from '../src/lib/server/inventory-view';

describe('inventory view formatting', () => {
	it('normalizes legacy magic effects and value dice', () => {
		expect(toInventoryViewItem({ kind: 'magic', name: 'Old ward', stat: 'defense' })).toMatchObject(
			{
				rarity: 'common',
				rarityLabel: 'Common',
				effects: ['defense +1'],
				valueText: '1d2 gold',
				valueNotation: '1d2',
				sellable: true
			}
		);
	});

	it('formats new effects and explicit dice without rolling', () => {
		const view = toInventoryViewItem({
			kind: 'magic',
			name: 'Star mantle',
			rarity: 'very_rare',
			effects: [
				{ target: 'attack', amount: 2 },
				{ target: 'skill', skill: 'Magic', amount: 1 }
			],
			valueDice: { count: 2, sides: 6 }
		});
		expect(view.rarityLabel).toBe('Very Rare');
		expect(view.effects).toEqual(['attack +2', 'Magic +1']);
		expect(view.valueText).toBe('2d6 gold');
	});

	it('gives fixed value precedence over dice', () => {
		const view = toInventoryViewItem({
			kind: 'valuable',
			name: 'Coin idol',
			value: 12,
			valueDice: { count: 9, sides: 9 }
		});
		expect(view.valueText).toBe('12 gold');
		expect(view.valueNotation).toBe('12');
	});

	it('describes consumed draught vitality and does not sell it', () => {
		const view = toInventoryViewItem(
			{
				kind: 'draught',
				name: 'Dawn draught',
				rarity: 'legendary',
				maxHpIncrease: 4,
				fullHeal: true,
				value: 99
			},
			{ consumed: true }
		);
		expect(view.effects).toEqual(['Maximum HP +4', 'Fully restores vitality']);
		expect(view.valueText).toBe('Consumed');
		expect(view.valueNotation).toBeNull();
		expect(view.sellable).toBe(false);
		expect(view.consumed).toBe(true);
	});
});
