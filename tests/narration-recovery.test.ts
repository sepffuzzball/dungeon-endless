import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
	process.env.DATABASE_URL = 'postgres://test:test@localhost/test';
	process.env.APP_ENCRYPTION_KEY =
		'0000000000000000000000000000000000000000000000000000000000000000';
	process.env.NODE_ENV = 'test';
	process.env.LLM_DIAGNOSTICS = 'true';
});

import type { NarrationStatus } from '../src/lib/types';
import { config } from '../src/lib/server/config';
import { LlmFailure, LLM_ROUTE_ERROR_LOG_PREFIX } from '../src/lib/server/llm-diagnostics';
import {
	_afterCommit as afterCommit,
	_currentRoomRevealed as currentRoomRevealed,
	_pendingNarrationTargets as pendingNarrationTargets,
	_phaseAfterEncounter as phaseAfterEncounter,
	_validActDuplicate as validActDuplicate,
	_validFollowupDuplicate as validFollowupDuplicate
} from '../src/routes/play/[runId]/+page.server';
import {
	_durableRoomNarrationAfterFailure as durableRoomNarrationAfterFailure,
	_durableTurnNarrationAfterFailure as durableTurnNarrationAfterFailure,
	_outerRouteDiagnostic as outerRouteDiagnostic,
	_preStreamDatabaseRouteError as preStreamDatabaseRouteError
} from '../src/routes/play/[runId]/stream/+server';

const paragraphCount = (text: string) =>
	text.split(/\n\n/).filter((paragraph) => paragraph.trim().length > 0).length;

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

describe('post-encounter route predicates', () => {
	const roomSnapshot = { type: 'monster' as const, roomNumber: 7, name: 'Hidden Horror' };
	const success = {
		result: 'reward' as const,
		hpBefore: 3,
		hpAfter: 3,
		hpDelta: 0,
		message: 'won'
	};

	it('conceals until an exact current room and version turn exists', () => {
		expect(currentRoomRevealed({ version: 4, roomNumber: 7 }, null)).toBe(false);
		expect(currentRoomRevealed({ version: 4, roomNumber: 7 }, { sequence: 3, roomSnapshot })).toBe(
			false
		);
		expect(currentRoomRevealed({ version: 4, roomNumber: 8 }, { sequence: 4, roomSnapshot })).toBe(
			false
		);
		expect(currentRoomRevealed({ version: 4, roomNumber: 7 }, { sequence: 4, roomSnapshot })).toBe(
			true
		);
	});

	it('selects loot, failure, fatal and immediate phases', () => {
		expect(phaseAfterEncounter('monster', success)).toBe('awaiting_loot');
		expect(phaseAfterEncounter('trap', { ...success, result: 'failure', hpAfter: 1 })).toBe(
			'awaiting_failure'
		);
		expect(phaseAfterEncounter('boss', { ...success, result: 'defeat', hpAfter: 0 })).toBe(
			'awaiting_failure'
		);
		expect(phaseAfterEncounter('treasure', success)).toBe('awaiting_proceed');
	});

	it('accepts duplicate follow-ups only for the exact next sequence and mode', () => {
		expect(
			validFollowupDuplicate(
				{ sequence: 6, intent: { narrationMode: 'loot_search' } },
				5,
				'loot_search'
			)
		).toBe(true);
		expect(
			validFollowupDuplicate(
				{ sequence: 7, intent: { narrationMode: 'loot_search' } },
				5,
				'loot_search'
			)
		).toBe(false);
		expect(
			validFollowupDuplicate(
				{ sequence: 6, intent: { narrationMode: 'failure_consequence' } },
				5,
				'loot_search'
			)
		).toBe(false);
		expect(validFollowupDuplicate({ sequence: 6, intent: {} }, 5, 'failure_consequence')).toBe(
			false
		);
	});

	it('accepts duplicate acts only for the exact next sequence and ordinary action mode', () => {
		expect(
			validActDuplicate({ sequence: 6, intent: { narrationMode: 'ordinary_action' } }, 5)
		).toBe(true);
		expect(validActDuplicate({ sequence: 6, intent: {} }, 5)).toBe(true);
		expect(
			validActDuplicate({ sequence: 7, intent: { narrationMode: 'ordinary_action' } }, 5)
		).toBe(false);
		expect(validActDuplicate({ sequence: 6, intent: { narrationMode: 'loot_search' } }, 5)).toBe(
			false
		);
		expect(
			validActDuplicate({ sequence: 6, intent: { narrationMode: 'failure_consequence' } }, 5)
		).toBe(false);
	});
});

describe('recovery diagnostics', () => {
	it('replaces partial token-truncated failure prose with the persisted five-paragraph fallback', () => {
		const durable = durableTurnNarrationAfterFailure({
			accumulated: 'partial model prose that must not remain',
			reason: 'response_truncated',
			room: { type: 'monster', name: 'Watcher' },
			actionText: 'I attack',
			outcome: {
				result: 'failure',
				hpBefore: 5,
				hpAfter: 4,
				hpDelta: -1,
				message: 'The watcher drives you back.'
			},
			rolls: [],
			narrationMode: 'ordinary_action',
			brutality: 5,
			debauchery: 1
		});
		expect(paragraphCount(durable)).toBe(5);
		expect(durable).not.toContain('partial model prose');
	});

	it('replaces partial byte-truncated consequence prose with the persisted seven-paragraph fallback', () => {
		const durable = durableTurnNarrationAfterFailure({
			accumulated: 'partial model prose that must not remain',
			reason: 'response_too_large',
			room: { type: 'boss', name: 'Watcher' },
			actionText: 'face the aftermath',
			outcome: {
				result: 'defeat',
				hpBefore: 0,
				hpAfter: 0,
				hpDelta: 0,
				message: 'The settled outcome remains.'
			},
			rolls: [],
			narrationMode: 'failure_consequence',
			brutality: 1,
			debauchery: 5
		});
		expect(paragraphCount(durable)).toBe(7);
		expect(durable).not.toContain('partial model prose');
	});

	it('retains partial prose for ordinary interruption but replaces a truncated room entry', () => {
		expect(
			durableTurnNarrationAfterFailure({
				accumulated: 'durable partial network prose',
				reason: 'network_error',
				room: { type: 'monster', name: 'Watcher' },
				actionText: 'I attack',
				outcome: {
					result: 'success',
					hpBefore: 5,
					hpAfter: 5,
					hpDelta: 0,
					message: 'Won.'
				},
				rolls: [],
				narrationMode: 'ordinary_action',
				brutality: 5,
				debauchery: 5
			})
		).toBe('durable partial network prose');
		const room = durableRoomNarrationAfterFailure({
			accumulated: 'partial room prose',
			reason: 'response_truncated',
			room: { type: 'rest', name: 'Long Hall' },
			runSummary: 'The run continues.'
		});
		expect(paragraphCount(room)).toBe(2);
		expect(room).not.toContain('partial room prose');
	});

	it('replaces partial incomplete-response prose with the persisted full fallback', () => {
		const durable = durableTurnNarrationAfterFailure({
			accumulated: 'partial model prose that must not remain',
			reason: 'response_incomplete',
			room: { type: 'monster', name: 'Watcher' },
			actionText: 'I attack',
			outcome: {
				result: 'failure',
				hpBefore: 5,
				hpAfter: 4,
				hpDelta: -1,
				message: 'The watcher drives you back.'
			},
			rolls: [],
			narrationMode: 'ordinary_action',
			brutality: 5,
			debauchery: 1
		});
		expect(paragraphCount(durable)).toBe(5);
		expect(durable).not.toContain('partial model prose');
		const room = durableRoomNarrationAfterFailure({
			accumulated: 'partial room prose',
			reason: 'response_incomplete',
			room: { type: 'rest', name: 'Long Hall' },
			runSummary: 'The run continues.'
		});
		expect(paragraphCount(room)).toBe(2);
		expect(room).not.toContain('partial room prose');
	});

	it('emits collected recovery intents only after a successful commit', async () => {
		config.LLM_DIAGNOSTICS = true;
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const recoveryDiagnostics = [
			{
				purpose: 'prose' as const,
				mode: 'non_enhanced' as const,
				reason: 'recovery_fallback' as const,
				correlationId: '00000000-0000-4000-8000-000000000000',
				runId: '11111111-1111-4111-8111-111111111111',
				targetId: '22222222-2222-4222-8222-222222222222',
				narrationKind: 'turn' as const
			}
		];

		await expect(
			afterCommit(Promise.resolve({ value: 'committed', recoveryDiagnostics }))
		).resolves.toBe('committed');
		expect(warn).toHaveBeenCalledTimes(1);

		await expect(afterCommit(Promise.reject(new Error('transaction rolled back')))).rejects.toThrow(
			'transaction rolled back'
		);
		expect(warn).toHaveBeenCalledTimes(1);
		warn.mockRestore();
	});

	it('builds a distinct sanitized route error instead of a false fallback', () => {
		const diagnostics = {
			correlationId: '00000000-0000-4000-8000-000000000000',
			runId: '11111111-1111-4111-8111-111111111111',
			targetId: '22222222-2222-4222-8222-222222222222',
			narrationKind: 'room' as const
		};
		const intent = outerRouteDiagnostic('room', diagnostics, new Error('raw database secret'));
		expect(intent).toEqual({
			purpose: 'room_prose',
			reason: 'database_or_route_error',
			...diagnostics
		});
		expect(intent).not.toHaveProperty('message');
		// A helper diagnostic before a failed fallback write does not turn this into
		// a second fallback warning; the outer failure remains a route error.
		expect(outerRouteDiagnostic('room', diagnostics, new Error('write failed'))).toEqual(intent);
	});

	it('logs a sanitized route error and rethrows for pre-producer lookup database failures', () => {
		config.LLM_DIAGNOSTICS = true;
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const diagnostics = {
			correlationId: '00000000-0000-4000-8000-000000000000',
			runId: '11111111-1111-4111-8111-111111111111',
			targetId: '22222222-2222-4222-8222-222222222222',
			narrationKind: 'turn' as const
		};
		const raw = new Error('raw postgres secret lookup failure');
		expect(() => preStreamDatabaseRouteError(diagnostics, raw)).toThrow(raw);
		expect(warn).toHaveBeenCalledTimes(1);
		const line = warn.mock.calls[0][0] as string;
		expect(line.startsWith(`${LLM_ROUTE_ERROR_LOG_PREFIX} `)).toBe(true);
		const payload = JSON.parse(line.slice(LLM_ROUTE_ERROR_LOG_PREFIX.length + 1));
		expect(payload).toMatchObject({
			event: 'llm_route_error',
			purpose: 'prose',
			reason: 'database_or_route_error',
			correlationId: diagnostics.correlationId,
			runId: diagnostics.runId,
			targetId: diagnostics.targetId,
			narrationKind: 'turn'
		});
		expect(payload).not.toHaveProperty('message');
		expect(line).not.toContain('raw postgres secret lookup failure');
		warn.mockRestore();
	});

	it('classifies typed outer failures and suppresses expected disconnect and lease noise', () => {
		const diagnostics = { narrationKind: 'turn' as const };
		expect(
			outerRouteDiagnostic('turn', diagnostics, new LlmFailure('timeout', 'bounded route timeout'))
		).toMatchObject({ purpose: 'prose', reason: 'timeout' });
		expect(
			outerRouteDiagnostic(
				'turn',
				diagnostics,
				new LlmFailure('client_disconnect', 'typed disconnect')
			)
		).toBeNull();
		expect(
			outerRouteDiagnostic('turn', diagnostics, new LlmFailure('lease_lost', 'typed lease loss'))
		).toBeNull();
	});
});
