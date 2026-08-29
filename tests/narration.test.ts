import { describe, expect, it } from 'vitest';
import {
	formatSseComment,
	formatSseEvent,
	isNarrationLeaseStale,
	persistedSuffix
} from '../src/lib/server/narration';

describe('narration SSE helpers', () => {
	it('encodes multiline payloads without injecting SSE fields', () => {
		expect(formatSseEvent('chunk', { text: 'one\ntwo' })).toBe(
			'event: chunk\ndata: {"text":"one\\ntwo"}\n\n'
		);
	});

	it('sanitizes keepalive comments', () => {
		expect(formatSseComment('still\nalive')).toBe(': still alive\n\n');
	});

	it('returns suffixes and detects repaired text', () => {
		expect(persistedSuffix('abc', 'abcdef')).toEqual({ text: 'def', reset: false });
		expect(persistedSuffix('abc', 'replacement')).toEqual({ text: 'replacement', reset: true });
	});

	it('detects only expired streaming leases', () => {
		const now = new Date('2026-01-01T00:00:31.000Z');
		expect(isNarrationLeaseStale('streaming', new Date('2026-01-01T00:00:00.000Z'), now)).toBe(
			true
		);
		expect(isNarrationLeaseStale('streaming', new Date('2026-01-01T00:00:02.000Z'), now)).toBe(
			false
		);
		expect(isNarrationLeaseStale('complete', null, now)).toBe(false);
	});
});
