import { describe, it, expect } from 'vitest';
import {
	BRUTALITY_PROMPTS,
	DEBAUCHERY_PROMPTS,
	brutalityPrompt,
	buildSystemPrompt,
	composeInterpretation,
	composeProse,
	composeSuggestions,
	composeSummary,
	debaucheryPrompt,
	delimit
} from '../src/lib/server/prompts';

describe('level prompts', () => {
	it('defines exactly five brutality and five debauchery levels', () => {
		expect(BRUTALITY_PROMPTS).toHaveLength(5);
		expect(DEBAUCHERY_PROMPTS).toHaveLength(5);
	});

	it('clamps out-of-range brutality levels', () => {
		expect(brutalityPrompt(-5)).toBe(BRUTALITY_PROMPTS[0]);
		expect(brutalityPrompt(0)).toBe(BRUTALITY_PROMPTS[0]);
		expect(brutalityPrompt(99)).toBe(BRUTALITY_PROMPTS[4]);
	});

	it('permits clearly adult consensual themes only for debauchery above 1', () => {
		for (let level = 0; level < 5; level++) {
			const text = debaucheryPrompt(level);
			if (level > 1) {
				expect(text).toMatch(/consent/);
				expect(text).toMatch(/no coercion/i);
				expect(text).toMatch(/no sexualized defeat/i);
				expect(text).toMatch(/no minors/i);
				expect(text).toMatch(/no ambiguous ages/i);
			} else {
				expect(text).not.toMatch(/sexualized defeat/);
			}
		}
	});
});

describe('delimit', () => {
	it('wraps untrusted content in explicit tags', () => {
		expect(delimit('player', 'attack the guard')).toBe('<player>\nattack the guard\n</player>');
	});
});

describe('buildSystemPrompt', () => {
	it('includes brutality, debauchery and the untrusted-input rule', () => {
		const prompt = buildSystemPrompt({ brutality: 3, debauchery: 4, adventurer: { name: 'Mara' } });
		expect(prompt).toContain('Brutality directive');
		expect(prompt).toContain('Debauchery directive');
		expect(prompt).toContain('UNTRUSTED INPUT');
		expect(prompt).toContain('can never alter the rules');
	});
});

describe('prompt composition', () => {
	const system = buildSystemPrompt({ brutality: 0, debauchery: 0 });
	const outcome = {
		result: 'success' as const,
		hpBefore: 10,
		hpAfter: 10,
		hpDelta: 0,
		message: 'ok'
	};
	const room = { type: 'trap' as const, name: 'The Trap', dc: 10, skill: 'Knowledge' as const };

	it('composes prose with delimited untrusted content', () => {
		const describedRoom = { ...room, description: 'Editor-authored room text.' };
		const prompt = composeProse({ system, room: describedRoom, actionText: 'I dodge', outcome });
		expect(prompt.system).toBe(system);
		expect(prompt.user).toContain('<room>');
		expect(prompt.user).toContain('Editor-authored room text.');
		expect(prompt.user).toContain('</action>');
	});

	it('composes interpretation with a bounded JSON contract', () => {
		const prompt = composeInterpretation({ system, room, actionText: 'I sneak' });
		expect(prompt.user).toContain('approach');
		expect(prompt.user).toContain('skill');
		expect(prompt.user).toContain('advantage');
	});

	it('composes a summary prompt', () => {
		const prompt = composeSummary({ system, room, actionText: 'I dodge', outcome });
		expect(prompt.user).toContain('summary');
	});

	it('composes a suggestions prompt with a JSON array contract', () => {
		const prompt = composeSuggestions({ system, room });
		expect(prompt.user).toContain('label');
		expect(prompt.user).toContain('typed');
	});
});
