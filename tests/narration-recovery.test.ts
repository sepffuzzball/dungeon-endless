import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
	process.env.DATABASE_URL = 'postgres://test:test@localhost/test';
	process.env.APP_ENCRYPTION_KEY =
		'0000000000000000000000000000000000000000000000000000000000000000';
	process.env.NODE_ENV = 'test';
});

import type { NarrationStatus } from '../src/lib/types';
import { _pendingNarrationTargets as pendingNarrationTargets } from '../src/routes/play/[runId]/+page.server';

type TurnFixture = {
	id: string;
	sequence: number;
	narrationStatus: NarrationStatus;
};
type EntryFixture = {
	id: string;
	status: NarrationStatus;
};

const turn = (id: string, sequence: number, narrationStatus: NarrationStatus): TurnFixture => ({
	id,
	sequence,
	narrationStatus
});
const entry = (id: string, status: NarrationStatus): EntryFixture => ({ id, status });

describe('pendingNarrationTargets', () => {
	it('returns pending and streaming turns oldest first, in sequence order', () => {
		expect(
			pendingNarrationTargets(
				[
					turn('t3', 3, 'streaming'),
					turn('t1', 1, 'pending'),
					turn('t2', 2, 'streaming'),
					turn('done', 0, 'complete')
				],
				null,
				'ready'
			)
		).toEqual([
			{ kind: 'turn', id: 't1' },
			{ kind: 'turn', id: 't2' },
			{ kind: 'turn', id: 't3' }
		]);
	});

	it('includes turns whose legacy roomSnapshot has no roomNumber, on any phase', () => {
		for (const phase of ['ready', 'awaiting_proceed'] as const) {
			expect(pendingNarrationTargets([turn('legacy', 7, 'pending')], null, phase)).toEqual([
				{ kind: 'turn', id: 'legacy' }
			]);
		}
	});

	it('deduplicates turn ids keeping the earliest entry', () => {
		expect(
			pendingNarrationTargets(
				[turn('dup', 9, 'pending'), turn('dup', 9, 'pending'), turn('other', 10, 'streaming')],
				null,
				'ready'
			)
		).toEqual([
			{ kind: 'turn', id: 'dup' },
			{ kind: 'turn', id: 'other' }
		]);
	});

	it('keeps a pending current room entry after the turns when the run is ready', () => {
		expect(
			pendingNarrationTargets(
				[turn('t1', 1, 'pending'), turn('t2', 2, 'streaming')],
				entry('room', 'pending'),
				'ready'
			)
		).toEqual([
			{ kind: 'turn', id: 't1' },
			{ kind: 'turn', id: 't2' },
			{ kind: 'room', id: 'room' }
		]);
	});

	it('omits the current room entry outside the ready phase', () => {
		expect(
			pendingNarrationTargets(
				[turn('t1', 1, 'pending')],
				entry('room', 'pending'),
				'awaiting_proceed'
			)
		).toEqual([{ kind: 'turn', id: 't1' }]);
	});

	it('omits the current room entry once it is resolved', () => {
		expect(
			pendingNarrationTargets([turn('t1', 1, 'pending')], entry('room', 'complete'), 'ready')
		).toEqual([{ kind: 'turn', id: 't1' }]);
	});

	it('returns an empty list when nothing is unresolved', () => {
		expect(pendingNarrationTargets([], entry('room', 'complete'), 'ready')).toEqual([]);
		expect(
			pendingNarrationTargets([turn('t1', 1, 'failed'), turn('t2', 2, 'complete')], null, 'ready')
		).toEqual([]);
	});
});
