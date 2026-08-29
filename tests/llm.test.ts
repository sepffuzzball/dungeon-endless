import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
	process.env.DATABASE_URL = 'postgres://test:test@localhost/test';
	process.env.APP_ENCRYPTION_KEY =
		'0000000000000000000000000000000000000000000000000000000000000000';
	process.env.NODE_ENV = 'test';
	process.env.LLM_MAX_RESPONSE_BYTES = '512';
});

vi.mock('../src/lib/server/validation', () => ({
	validateLlmUrl: (raw: string) => new URL(raw),
	validateResolvedLlmUrl: async (raw: string) => new URL(raw)
}));

import {
	OpenAiSseDecoder,
	callChatStream,
	fallbackProse,
	fallbackRoomEntry,
	fallbackSummary,
	parseSseChunk,
	streamProse,
	streamRoomEntry,
	type EndpointSource,
	type StreamChunk
} from '../src/lib/server/llm';

const encoder = new TextEncoder();
const endpoint = (name = 'primary'): EndpointSource => ({
	name,
	purpose: 'prose',
	baseUrl: 'https://models.example/v1',
	model: name,
	apiKeyEnc: null,
	enabled: true,
	timeoutMs: 1000
});

function responseFrom(parts: string[]): Response {
	return new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				for (const part of parts) controller.enqueue(encoder.encode(part));
				controller.close();
			}
		}),
		{ status: 200 }
	);
}

async function collect(stream: AsyncGenerator<StreamChunk>): Promise<string> {
	let text = '';
	for await (const chunk of stream) text += chunk.content;
	return text;
}

const proseInput = {
	system: 'system',
	room: { type: 'monster' as const, name: 'Watcher' },
	actionText: 'attack',
	outcome: {
		result: 'success' as const,
		hpBefore: 5,
		hpAfter: 5,
		hpDelta: 0,
		message: 'won'
	}
};

const roll = (total: number, target: number) => ({
	label: 'Attack',
	dice: [total],
	selected: total,
	modifier: 0,
	total,
	target,
	success: total >= target,
	advantage: 0
});

describe('deterministic prose fallbacks', () => {
	it('writes the submitted action as its own sentence before a successful near-roll outcome', () => {
		const text = fallbackProse(
			{ type: 'monster', name: 'Watcher' },
			'I strike hard',
			{ ...proseInput.outcome, message: 'The Watcher falls.' },
			[roll(9, 8)]
		);
		expect(text).toMatch(/^You strike hard\.\n\n/);
		expect(text).toContain('The Watcher falls.');
		expect(text).toContain('a near result by 1');
		expect(text).toContain('Your HP remains 5');
		expect(text).toContain('No injury is recorded');
	});

	it('reports failure, a wide roll, HP loss, and injury coherently', () => {
		const text = fallbackProse(
			{ type: 'trap', name: 'Needle Floor' },
			'I leap across.',
			{
				result: 'failure',
				hpBefore: 5,
				hpAfter: 4,
				hpDelta: -1,
				message: 'The needles catch you.',
				injury: 'a punctured heel'
			},
			[roll(3, 8)]
		);
		expect(text).toMatch(/^You leap across\.\n\n/);
		expect(text).toContain('a wide result by 5');
		expect(text).toContain('falling from 5 to 4');
		expect(text).toContain('The recorded injury is a punctured heel');
	});

	it('states when no roll is required and covers every room fallback', () => {
		for (const type of ['monster', 'boss', 'trap', 'treasure', 'rest'] as const) {
			const text = fallbackProse(
				{ type, name: 'Named Threat' },
				'I proceed carefully',
				{
					result: type === 'rest' ? 'rest' : type === 'treasure' ? 'reward' : 'success',
					hpBefore: 5,
					hpAfter: type === 'rest' ? 6 : 5,
					hpDelta: type === 'rest' ? 1 : 0,
					message: 'The outcome is settled.'
				},
				[]
			);
			expect(text).toContain('No roll is required.');
			expect(text.toLowerCase()).not.toContain('step into named threat');
		}
	});

	it('keeps every room-entry fallback environment-first and within two paragraphs', () => {
		for (const type of ['monster', 'boss', 'trap', 'treasure', 'rest'] as const) {
			const text = fallbackRoomEntry(
				{ type, name: 'Named Threat', description: 'A saved description.' },
				'A saved run summary.'
			);
			expect(text.split(/\n\n/)).toHaveLength(2);
			expect(text.toLowerCase()).not.toContain('step into named threat');
			expect(text.indexOf('Named Threat')).toBeGreaterThan(text.indexOf('\n\n'));
		}
	});
});

describe('deterministic summary fallbacks', () => {
	it('normalizes a first-person action into second person', () => {
		const text = fallbackSummary({ type: 'monster', name: 'Watcher' }, 'I attack the watcher', {
			result: 'success',
			hpBefore: 5,
			hpAfter: 5,
			hpDelta: 0,
			message: 'The watcher falls.'
		});
		expect(text).toMatch(/^You attack the watcher\./);
	});

	it('trims duplicate punctuation from submitted actions', () => {
		const text = fallbackSummary({ type: 'trap', name: 'Needle Floor' }, 'I leap across!', {
			result: 'success',
			hpBefore: 5,
			hpAfter: 5,
			hpDelta: 0,
			message: 'You make it.'
		});
		expect(text).toMatch(/^You leap across\./);
		expect(text).not.toContain('!');
	});

	it('distinguishes an unchanged HP from a recovered one', () => {
		const unchanged = fallbackSummary({ type: 'monster', name: 'Watcher' }, 'guard the corridor', {
			result: 'success',
			hpBefore: 5,
			hpAfter: 5,
			hpDelta: 0,
			message: 'All clear.'
		});
		const recovered = fallbackSummary({ type: 'rest', name: 'Long Hall' }, 'I rest here', {
			result: 'rest',
			hpBefore: 5,
			hpAfter: 6,
			hpDelta: 1,
			message: 'You feel restored.'
		});
		expect(unchanged).toContain('HP was unchanged');
		expect(recovered).toContain('recovered 1 HP');
		expect(recovered).toMatch(/^You rest here\./);
	});

	it('reports recovered rewards when present', () => {
		const text = fallbackSummary({ type: 'treasure', name: 'Cache' }, 'open the chest', {
			result: 'reward',
			hpBefore: 5,
			hpAfter: 5,
			hpDelta: 0,
			message: 'Loot taken.',
			rewards: [{ kind: 'valuable', name: 'Gem' }]
		});
		expect(text).toContain('recovered 1 item');
		expect(text).toContain('Loot taken.');
	});

	it('reports failure with HP loss and injury without inventing state', () => {
		const text = fallbackSummary({ type: 'trap', name: 'Needle Floor' }, 'spring the trap', {
			result: 'failure',
			hpBefore: 5,
			hpAfter: 3,
			hpDelta: -2,
			message: 'The needles catch you.',
			injury: 'a punctured heel'
		});
		expect(text).toContain('lost 2 HP');
		expect(text).toContain('a punctured heel');
		expect(text).toContain('The needles catch you.');
	});
});

describe('OpenAI SSE decoding', () => {
	it('preserves split UTF-8 and handles CRLF, comments, multiline data and a residual line', () => {
		const decoder = new OpenAiSseDecoder();
		const wire = encoder.encode(
			': keepalive\r\nevent: delta\r\ndata: first\r\ndata: 🙂\r\n\r\ndata: tail'
		);
		const split = wire.indexOf(0xf0) + 2;
		expect(decoder.push(wire.slice(0, split))).toEqual([]);
		expect(decoder.push(wire.slice(split))).toEqual([{ event: 'delta', data: 'first\n🙂' }]);
		expect(decoder.flush()).toEqual([{ data: 'tail', event: undefined }]);
	});

	it('recognizes DONE and ignores empty or malformed event data', () => {
		expect(parseSseChunk({ data: '[DONE]' })).toEqual({ content: '', done: true });
		expect(parseSseChunk({ data: '' })).toEqual({ content: '', done: false });
		expect(parseSseChunk({ data: '{bad json' })).toEqual({ content: '', done: false });
		expect(parseSseChunk({ data: '{"choices":[{"delta":{"content":"ok"}}]}' })).toEqual({
			content: 'ok',
			done: false
		});
	});

	it('does not treat a CRLF split between chunks as an empty event', () => {
		const decoder = new OpenAiSseDecoder();
		expect(decoder.push(encoder.encode('data: one\r'))).toEqual([]);
		expect(decoder.push(encoder.encode('\ndata: two\r\n\r\n'))).toEqual([
			{ data: 'one\ntwo', event: undefined }
		]);
	});
});

describe('streaming helpers', () => {
	beforeEach(() => vi.restoreAllMocks());

	it('decodes OpenAI chunks and stops at DONE', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				responseFrom([
					'data: {"choices":[{"delta":{"content":"hel"}}]}\n\n',
					'data: {"choices":[{"delta":{"content":"lo"}}]}\r\n\r\n',
					'data: [DONE]\n\n'
				])
			)
		);
		expect(await collect(callChatStream(endpoint(), []))).toBe('hello');
	});

	it('uses only the first enabled prose endpoint and falls back when it fails before output', async () => {
		const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
			void args;
			throw new Error('offline');
		});
		vi.stubGlobal('fetch', fetchMock);
		const text = await collect(
			streamProse({ ...proseInput, endpoints: [endpoint('z-last'), endpoint('a-first')] })
		);
		expect(text).toContain('Watcher');
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).model).toBe('a-first');
	});

	it('falls back when an upstream closes successfully without text', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => responseFrom([': keepalive\n\ndata: [DONE]\n\n']))
		);
		expect(await collect(streamProse({ ...proseInput, endpoints: [endpoint()] }))).toContain(
			'Watcher'
		);
	});

	it('streams deterministic room-entry fallback chunks when no prose endpoint exists', async () => {
		const chunks: string[] = [];
		for await (const chunk of streamRoomEntry({
			system: 'system',
			room: { type: 'rest', name: 'Long Hall', description: 'x'.repeat(120) },
			runSummary: '',
			character: {
				name: 'Mara',
				companyName: 'The Endless Company',
				description: '',
				height: 'Tall',
				build: 'Lean',
				species: 'Human',
				calling: 'Warden',
				stats: { body: 1, mind: 0, spirit: 0 }
			},
			inventory: [],
			endpoints: []
		})) {
			chunks.push(chunk.content);
		}
		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks.join('')).toContain('Long Hall');
	});

	it('propagates an upstream error after text instead of appending fallback prose', async () => {
		let pull = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						new ReadableStream<Uint8Array>({
							pull(controller) {
								if (pull++ === 0) {
									controller.enqueue(
										encoder.encode('data: {"choices":[{"delta":{"content":"upstream"}}]}\n\n')
									);
								} else controller.error(new Error('stream failed'));
							}
						}),
						{ status: 200 }
					)
			)
		);
		const seen: string[] = [];
		await expect(
			(async () => {
				for await (const chunk of streamProse({ ...proseInput, endpoints: [endpoint()] })) {
					seen.push(chunk.content);
				}
			})()
		).rejects.toThrow('stream failed');
		expect(seen.join('')).toBe('upstream');
	});

	it('cancels and rejects streams that exceed the total byte bound', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => responseFrom(['x'.repeat(513)]))
		);
		await expect(collect(callChatStream(endpoint(), []))).rejects.toThrow('bounded read limit');
	});
});
