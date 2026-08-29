import { describe, expect, it } from 'vitest';
import { retirementConfirmed } from '../src/lib/server/character-lifecycle';

describe('retirementConfirmed', () => {
	it('requires both the explicit checkbox and an exact character-name match', () => {
		expect(retirementConfirmed('Aster Vale', 'Aster Vale', true)).toBe(true);
		expect(retirementConfirmed('Aster Vale', 'aster vale', true)).toBe(false);
		expect(retirementConfirmed('Aster Vale', 'Aster Vale', false)).toBe(false);
	});

	it('does not accept a missing confirmation name', () => {
		expect(retirementConfirmed('Aster Vale', null, true)).toBe(false);
	});
});
