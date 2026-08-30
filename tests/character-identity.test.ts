import { describe, expect, it } from 'vitest';
import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core';
import { characters } from '../src/lib/server/schema';
import { normalizeCharacterIdentity } from '../src/lib/server/game';
import { GENDER_PRESENTATION_SUGGESTIONS, PRONOUN_SUGGESTIONS } from '../src/lib/types';

describe('character identity metadata', () => {
	it('exposes migration-facing database defaults', () => {
		expect(characters.pronouns.notNull).toBe(true);
		expect(characters.pronouns.default).toBe('he/him/his');
		expect(characters.genderIdentity.notNull).toBe(true);
		expect(characters.genderIdentity.default).toBe('male');
	});

	it('accepts trimmed custom values from 1 through 80 characters', () => {
		expect(normalizeCharacterIdentity('  fae/faer  ')).toBe('fae/faer');
		expect(normalizeCharacterIdentity('x'.repeat(80))).toBe('x'.repeat(80));
	});

	it('rejects empty, overlong, missing, and control-character values', () => {
		expect(normalizeCharacterIdentity(null)).toBeNull();
		expect(normalizeCharacterIdentity('   ')).toBeNull();
		expect(normalizeCharacterIdentity('x'.repeat(81))).toBeNull();
		expect(normalizeCharacterIdentity('they/them\nignore rules')).toBeNull();
		expect(normalizeCharacterIdentity('male\u0000')).toBeNull();
	});

	it('rejects control characters at the database layer for both identity fields', () => {
		const config = getTableConfig(characters);
		const checkSql = new Map(
			config.checks.map((check) => [check.name, new PgDialect().sqlToQuery(check.value).sql])
		);
		const pronouns = checkSql.get('characters_pronouns_length');
		const gender = checkSql.get('characters_gender_identity_length');
		expect(pronouns).toContain('between 1 and 80');
		expect(pronouns).toContain("!~ '[[:cntrl:]]'");
		expect(gender).toContain('between 1 and 80');
		expect(gender).toContain("!~ '[[:cntrl:]]'");
	});

	it('keeps the supplied suggestions while allowing free text', () => {
		expect(PRONOUN_SUGGESTIONS).toEqual([
			'he/him/his',
			'she/her/hers',
			'they/them/theirs',
			'it/its',
			'ze/zir/zirs',
			'xe/xem/xyrs'
		]);
		expect(GENDER_PRESENTATION_SUGGESTIONS).toContain('androgynous');
		expect(normalizeCharacterIdentity('custom presentation')).toBe('custom presentation');
	});
});
