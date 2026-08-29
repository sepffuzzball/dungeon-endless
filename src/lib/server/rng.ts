import type { RollRecord } from '$lib/types';

/**
 * Deterministic seeded RNG for the dungeon rules.
 *
 * A stream is derived from a stable string key composed of the run seed, the
 * current room number, the turn sequence and a purpose label, so the same
 * inputs always yield the same rolls regardless of process or machine. No
 * global or wall-clock state is used.
 */

export interface Rng {
	/** Uniform float in [0, 1). */
	next(): number;
	/** Uniform integer in [1, 10]. */
	d10(): number;
	/** Uniform integer in [min, max] (both inclusive). */
	range(min: number, max: number): number;
	/** Uniform element from a non-empty array. */
	pick<T>(items: readonly T[]): T;
	/** Weighted selection; items carry a positive numeric `weight`. */
	weighted<T extends { weight: number }>(items: readonly T[]): T;
}

/** Result of a check; an exact superset of the persisted RollRecord. */
export interface RollCheckResult extends RollRecord {
	/** Index into `dice` of the selected die. */
	selectedIndex: number;
}

const TWO_POW_32 = 4294967296;

/** Small non-cryptographic string hash (cyrb128); returns a uint32. */
function hashString(input: string): number {
	let h1 = 1779033703 ^ input.length;
	let h2 = 3144134277;
	let h3 = 1013904242;
	let h4 = 2773480762;
	for (let i = 0; i < input.length; i++) {
		const byte = input.charCodeAt(i);
		h1 = Math.imul(h1 ^ byte, 597399067);
		h2 = Math.imul(h2 ^ byte, 2869860233);
		h3 = Math.imul(h3 ^ byte, 951274213);
		h4 = Math.imul(h4 ^ byte, 2716044179);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h3 ^ (h3 >>> 16), 2246822507) ^ Math.imul(h4 ^ (h4 >>> 13), 3266489909);
	return (h2 ^ (h1 >>> 15)) >>> 0;
}

/**
 * Creates a fresh deterministic RNG stream for the given context.
 * `purpose` separates unrelated streams (room generation, rolls, names...).
 */
export function createRng(seed: string, room: number, turn: number, purpose: string): Rng {
	const state0 = hashString(`${seed}:${room}:${turn}:${purpose}`);
	// Mix in a second word so related keys diverge even at the first draw.
	const state1 = hashString(`${seed}:${room}:${turn}:${purpose}:salt`) | 0;
	let a = state0 | 0;
	let b = state1 | 0;

	const next = (): number => {
		let t = (a += 0x6d2b79f5) | 0;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		const out = ((t ^ (t >>> 14)) >>> 0) / TWO_POW_32;
		// Weave in the second word so both halves advance together.
		const u = (b += 0x9e3779b1) | 0;
		const mixed = (out + (u >>> 0) / TWO_POW_32) % 1;
		return mixed;
	};

	return {
		next,
		d10: () => 1 + Math.floor(next() * 10),
		range: (min: number, max: number) => {
			if (max < min) return min;
			return min + Math.floor(next() * (max - min + 1));
		},
		pick: (items) => {
			if (items.length === 0) throw new Error('pick: empty items');
			return items[Math.floor(next() * items.length)];
		},
		weighted: (items) => {
			if (items.length === 0) throw new Error('weighted: empty items');
			let total = 0;
			for (const item of items) total += item.weight;
			if (total <= 0) throw new Error('weighted: non-positive total weight');
			let roll = next() * total;
			for (const item of items) {
				roll -= item.weight;
				if (roll < 0) return item;
			}
			return items[items.length - 1];
		}
	};
}

/**
 * Resolves a d10 check against a target with advantage/disadvantage.
 *
 * Net advantage `N` rolls `abs(N) + 1` dice and keeps the highest for a
 * positive advantage, the lowest for a negative one, and a single die for
 * zero. A roll meeting the target exactly still succeeds.
 */
export function rollCheck(
	modifier: number,
	target: number,
	advantage: number,
	label: string,
	rng: Rng
): RollCheckResult {
	const clamped = Math.max(-2, Math.min(2, Math.floor(advantage)));
	const count = Math.abs(clamped) + 1;
	const dice: number[] = [];
	for (let i = 0; i < count; i++) dice.push(rng.d10());

	let selected: number;
	let selectedIndex: number;
	if (clamped > 0) {
		selected = Math.max(...dice);
		selectedIndex = dice.indexOf(selected);
	} else if (clamped < 0) {
		selected = Math.min(...dice);
		selectedIndex = dice.indexOf(selected);
	} else {
		selected = dice[0];
		selectedIndex = 0;
	}

	const total = selected + modifier;
	return {
		label,
		dice,
		selected,
		selectedIndex,
		modifier,
		total,
		target,
		success: total >= target,
		advantage: clamped
	};
}
