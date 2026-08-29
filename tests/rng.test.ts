import { describe, it, expect } from 'vitest';
import { createRng, rollCheck, type Rng } from '../src/lib/server/rng';

/** A scripted rng whose d10 returns the provided values in order. */
function scriptedRng(values: number[]): Rng {
	let index = 0;
	const next = (): number => {
		const value = index < values.length ? values[index] : 5;
		index += 1;
		return value;
	};
	return {
		next: () => next() / 10,
		d10: next,
		range: (min, max) => min + Math.floor((next() / 10) * (max - min + 1)),
		pick: (items) => items[Math.floor((next() / 10) * items.length)],
		weighted: (items) => items[0]
	};
}

describe('createRng', () => {
	it('is reproducible for identical seeds and context', () => {
		const a = createRng('seed-1', 3, 7, 'roll');
		const b = createRng('seed-1', 3, 7, 'roll');
		for (let i = 0; i < 20; i++) expect(a.next()).toBe(b.next());
	});

	it('diverges for different seeds', () => {
		const a = createRng('seed-1', 3, 7, 'roll');
		const b = createRng('seed-2', 3, 7, 'roll');
		const draws = (r: Rng) => Array.from({ length: 5 }, () => r.d10());
		expect(draws(a)).not.toEqual(draws(b));
	});

	it('diverges for different rooms, turns and purposes', () => {
		const a = createRng('seed-1', 3, 7, 'roll');
		const b = createRng('seed-1', 4, 7, 'roll');
		const c = createRng('seed-1', 3, 8, 'roll');
		const d = createRng('seed-1', 3, 7, 'name');
		const draws = (r: Rng) => Array.from({ length: 5 }, () => r.d10());
		expect(draws(a)).not.toEqual(draws(b));
		expect(draws(a)).not.toEqual(draws(c));
		expect(draws(a)).not.toEqual(draws(d));
	});

	it('keeps d10 and range within their bounds', () => {
		const rng = createRng('bounds', 1, 1, 'roll');
		for (let i = 0; i < 500; i++) {
			const die = rng.d10();
			expect(die).toBeGreaterThanOrEqual(1);
			expect(die).toBeLessThanOrEqual(10);
			const n = rng.range(2, 5);
			expect(n).toBeGreaterThanOrEqual(2);
			expect(n).toBeLessThanOrEqual(5);
		}
	});

	it('weighted choice stays within the given items', () => {
		const items = [
			{ kind: 'a', weight: 50 },
			{ kind: 'b', weight: 20 },
			{ kind: 'c', weight: 10 },
			{ kind: 'd', weight: 10 }
		];
		for (let s = 0; s < 200; s++) {
			const rng = createRng(`weighted-${s}`, 1, 1, 'room');
			const chosen = rng.weighted(items).kind;
			expect(items.some((item) => item.kind === chosen)).toBe(true);
		}
	});

	it('pick selects deterministically', () => {
		const a = createRng('pick', 1, 1, 'pick');
		const b = createRng('pick', 1, 1, 'pick');
		expect(a.pick(['x', 'y', 'z'])).toBe(b.pick(['x', 'y', 'z']));
	});
});

describe('rollCheck', () => {
	it('rolls a single die with no advantage', () => {
		const result = rollCheck(2, 12, 0, 'Test', scriptedRng([7]));
		expect(result.dice).toEqual([7]);
		expect(result.selected).toBe(7);
		expect(result.selectedIndex).toBe(0);
		expect(result.modifier).toBe(2);
		expect(result.total).toBe(9);
		expect(result.success).toBe(false);
		expect(result.advantage).toBe(0);
	});

	it('selects the highest die under positive advantage', () => {
		const result = rollCheck(1, 10, 2, 'Adv', scriptedRng([2, 9, 5]));
		expect(result.dice).toEqual([2, 9, 5]);
		expect(result.selected).toBe(9);
		expect(result.selectedIndex).toBe(1);
		expect(result.total).toBe(10);
		expect(result.success).toBe(true);
	});

	it('selects the lowest die under negative advantage', () => {
		const result = rollCheck(0, 5, -1, 'Dis', scriptedRng([8, 3]));
		expect(result.dice).toEqual([8, 3]);
		expect(result.selected).toBe(3);
		expect(result.selectedIndex).toBe(1);
		expect(result.total).toBe(3);
		expect(result.success).toBe(false);
	});

	it('succeeds on an exact tie with the target', () => {
		const result = rollCheck(4, 11, 0, 'Tie', scriptedRng([7]));
		expect(result.total).toBe(11);
		expect(result.success).toBe(true);
	});

	it('clamps advantage into -2..2', () => {
		const high = rollCheck(0, 99, 99, 'Clamp', scriptedRng([9, 9, 9]));
		expect(high.advantage).toBe(2);
		expect(high.dice).toHaveLength(3);
		const low = rollCheck(0, -99, -99, 'Clamp', scriptedRng([1, 1, 1]));
		expect(low.advantage).toBe(-2);
		expect(low.dice).toHaveLength(3);
	});
});
