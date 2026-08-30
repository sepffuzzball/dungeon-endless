import type { InventoryItem, InventoryViewItem, ItemRarity } from '$lib/types';
import { formatDice, formatItemEffects, normalizeInventoryItem } from './game';

const RARITY_LABELS: Record<ItemRarity, string> = {
	common: 'Common',
	uncommon: 'Uncommon',
	rare: 'Rare',
	very_rare: 'Very Rare',
	legendary: 'Legendary',
	artifact: 'Artifact'
};

function draughtEffects(item: ReturnType<typeof normalizeInventoryItem>): string[] {
	if (item.kind !== 'draught') return [];
	const effects: string[] = [];
	if ((item.maxHpIncrease ?? 0) > 0) effects.push(`Maximum HP +${item.maxHpIncrease}`);
	if (item.fullHeal) effects.push('Fully restores vitality');
	else effects.push(`Restores ${item.healAmount ?? 1} vitality`);
	if (item.overhealToMaxHp) effects.push('Excess healing raises maximum HP');
	return effects;
}

/** Maps persisted and legacy items to a stable, non-randomized page contract. */
export function toInventoryViewItem(
	raw: InventoryItem,
	options: { consumed?: boolean } = {}
): InventoryViewItem {
	const item = normalizeInventoryItem(raw);
	const consumed = options.consumed === true;
	const sellable = item.kind !== 'draught' && item.sellable !== false;
	const valueNotation = sellable
		? item.value !== undefined
			? String(item.value)
			: item.valueDice
				? formatDice(item.valueDice)
				: null
		: null;
	const effects = [
		...(item.effects ?? []).map((effect) => formatItemEffects([effect])),
		...draughtEffects(item)
	];

	return {
		kind: item.kind,
		name: item.name,
		description: item.description ?? '',
		rarity: item.rarity ?? 'common',
		rarityLabel: RARITY_LABELS[item.rarity ?? 'common'],
		effects,
		valueText: consumed
			? 'Consumed'
			: !sellable
				? 'Not sold'
				: valueNotation
					? `${valueNotation} gold`
					: 'Not sold',
		valueNotation,
		sellable,
		consumed
	};
}

export function toInventoryView(
	items: readonly InventoryItem[] | undefined,
	options: { consumedDraughts?: boolean } = {}
): InventoryViewItem[] {
	return (items ?? []).map((item) =>
		toInventoryViewItem(item, {
			consumed: options.consumedDraughts === true && item.kind === 'draught'
		})
	);
}
