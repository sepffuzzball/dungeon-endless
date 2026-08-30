import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { config } from '../src/lib/server/config';
import { LlmFailure, LLM_FALLBACK_LOG_PREFIX } from '../src/lib/server/llm-diagnostics';
import {
	OpenAiSseDecoder,
	callChatStream,
	fallbackProse,
	fallbackRoomEntry,
	fallbackSummary,
	interpretAction,
	narrateProse,
	parseSseChunk,
	streamProse,
	streamRoomEntry,
	suggestActions,
	type EndpointSource,
	type StreamChunk
} from '../src/lib/server/llm';

const encoder = new TextEncoder();
const endpoint = (name = 'primary'): EndpointSource => ({
	id: '33333333-3333-4333-8333-333333333333',
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

	it('uses exact, safe mode-specific loot and failure fallbacks', () => {
		const loot = fallbackProse(
			{ type: 'monster', name: 'Watcher' },
			'search',
			{
				...proseInput.outcome,
				rewards: [{ kind: 'draught', name: 'Draught of Rest' }],
				carriedRewards: []
			},
			[],
			'loot_search'
		);
		expect(loot).toContain('exactly Draught of Rest');
		expect(loot).toContain('consumed as recorded');

		const failure = fallbackProse(
			{ type: 'trap', name: 'Needle Floor' },
			'anything',
			{
				result: 'failure',
				hpBefore: 5,
				hpAfter: 4,
				hpDelta: -1,
				message: 'The mechanism catches you.'
			},
			[],
			'failure_consequence'
		);
		expect(failure).toContain('No injury is recorded');
		expect(failure).not.toMatch(/sexual|dismember|death/i);
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
		const onFallbackDiagnostic = vi.fn();
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
				pronouns: 'he/him/his',
				genderIdentity: 'male',
				species: 'Human',
				calling: 'Warden',
				stats: { body: 1, mind: 0, spirit: 0 }
			},
			inventory: [],
			endpoints: [],
			onFallbackDiagnostic
		})) {
			chunks.push(chunk.content);
		}
		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks.join('')).toContain('Long Hall');
		expect(onFallbackDiagnostic).toHaveBeenCalledTimes(1);
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
		).rejects.toBeInstanceOf(LlmFailure);
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

describe('fallback diagnostics', () => {
	let warn: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		config.LLM_DIAGNOSTICS = true;
		warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => {
		config.LLM_DIAGNOSTICS = true;
		warn.mockRestore();
	});

	function parseLog(line: unknown): Record<string, unknown> {
		return JSON.parse((line as string).slice(LLM_FALLBACK_LOG_PREFIX.length + 1)) as Record<
			string,
			unknown
		>;
	}

	it('logs no_enabled_endpoint when no prose endpoint exists', async () => {
		const onFallbackDiagnostic = vi.fn();
		await collect(streamProse({ ...proseInput, endpoints: [], onFallbackDiagnostic }));
		expect(warn).toHaveBeenCalledTimes(1);
		expect(onFallbackDiagnostic).toHaveBeenCalledTimes(1);
		const payload = parseLog(warn.mock.calls[0][0]);
		expect(payload.reason).toBe('no_enabled_endpoint');
		expect(payload.mode).toBe('stream');
		expect(payload.purpose).toBe('prose');
		expect(payload.configuredMaxTokens).toBe(config.LLM_MAX_TOKENS);
		expect(payload.configuredResponseByteLimit).toBe(config.LLM_MAX_RESPONSE_BYTES);
		expect(payload).not.toHaveProperty('name');
	});

	it('logs no_content_delta when the stream closes without text', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => responseFrom([': keepalive\n\ndata: [DONE]\n\n']))
		);
		const onFallbackDiagnostic = vi.fn();
		await collect(streamProse({ ...proseInput, endpoints: [endpoint()], onFallbackDiagnostic }));
		expect(warn).toHaveBeenCalledTimes(1);
		expect(onFallbackDiagnostic).toHaveBeenCalledTimes(1);
		const payload = parseLog(warn.mock.calls[0][0]);
		expect(payload.reason).toBe('no_content_delta');
		expect(payload).not.toHaveProperty('name');
		expect(payload.sseEvents).toBe(1);
		expect(payload.parseFailures).toBe(0);
	});

	it('logs stream_parse_error when malformed events produced no content', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => responseFrom(['data: {bad json}\n\n', 'data: [DONE]\n\n']))
		);
		const onFallbackDiagnostic = vi.fn();
		await collect(streamProse({ ...proseInput, endpoints: [endpoint()], onFallbackDiagnostic }));
		expect(warn).toHaveBeenCalledTimes(1);
		expect(onFallbackDiagnostic).toHaveBeenCalledTimes(1);
		const payload = parseLog(warn.mock.calls[0][0]);
		expect(payload.reason).toBe('stream_parse_error');
		expect(payload.parseFailures).toBe(1);
	});

	it.each([
		'{"error":{"message":"secret upstream error"}}',
		'{"object":"chat.completion.chunk"}',
		'{"choices":{}}',
		'{"choices":[{}]}',
		'{"choices":[{"delta":{"content":7}}]}'
	])('counts an unaccepted OpenAI event shape as malformed: %s', async (data) => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => responseFrom([`data: ${data}\n\ndata: [DONE]\n\n`]))
		);
		await collect(streamProse({ ...proseInput, endpoints: [endpoint()] }));
		const payload = parseLog(warn.mock.calls[0][0]);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(payload.reason).toBe('stream_parse_error');
		expect(payload.parseFailures).toBe(1);
		expect(String(warn.mock.calls[0][0])).not.toContain('secret upstream error');
	});

	it('accepts role, finish, and bounded metadata events without parse failures', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				responseFrom([
					'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
					'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
					'data: {"object":"chat.completion.chunk","choices":[]}\n\n',
					'data: [DONE]\n\n'
				])
			)
		);
		await collect(streamProse({ ...proseInput, endpoints: [endpoint()] }));
		const payload = parseLog(warn.mock.calls[0][0]);
		expect(payload.reason).toBe('no_content_delta');
		expect(payload.parseFailures).toBe(0);
	});

	it('logs one final classified diagnostic when a stream fails after content', async () => {
		let pull = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						new ReadableStream<Uint8Array>({
							pull(controller) {
								if (pull++ === 0)
									controller.enqueue(
										encoder.encode('data: {"choices":[{"delta":{"content":"kept"}}]}\n\n')
									);
								else controller.error(new Error('raw secret stream failure'));
							}
						}),
						{ status: 200 }
					)
			)
		);
		const seen: string[] = [];
		let failure: unknown;
		try {
			for await (const chunk of streamProse({ ...proseInput, endpoints: [endpoint()] }))
				seen.push(chunk.content);
		} catch (error) {
			failure = error;
		}
		expect(seen.join('')).toBe('kept');
		expect(failure).toMatchObject({ reason: 'network_error', diagnosticLogged: true });
		expect(warn).toHaveBeenCalledTimes(1);
		const payload = parseLog(warn.mock.calls[0][0]);
		expect(payload.contentDeltas).toBe(1);
		expect(payload.visibleChars).toBe(4);
		expect(String(warn.mock.calls[0][0])).not.toContain('raw secret stream failure');
	});

	it('logs the exact cumulative visible room-entry characters on a midstream failure', async () => {
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
										encoder.encode('data: {"choices":[{"delta":{"content":"seven!!"}}]}\n\n')
									);
								} else controller.error(new Error('secret room stream failure'));
							}
						}),
						{ status: 200 }
					)
			)
		);
		await expect(
			collect(
				streamRoomEntry({
					system: 'system',
					room: { type: 'rest', name: 'Long Hall' },
					runSummary: '',
					character: {
						name: 'Mara',
						companyName: 'Company',
						description: '',
						height: 'Tall',
						build: 'Lean',
						pronouns: 'he/him/his',
						genderIdentity: 'male',
						species: 'Human',
						calling: 'Warden',
						stats: { body: 1, mind: 0, spirit: 0 }
					},
					inventory: [],
					endpoints: [endpoint()]
				})
			)
		).rejects.toMatchObject({ diagnosticLogged: true });
		expect(warn).toHaveBeenCalledTimes(1);
		const payload = parseLog(warn.mock.calls[0][0]);
		expect(payload.purpose).toBe('room_prose');
		expect(payload.visibleChars).toBe(7);
		expect(String(warn.mock.calls[0][0])).not.toContain('secret room stream failure');
	});

	it('logs response_too_large both before and after visible stream content', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => responseFrom(['x'.repeat(513)]))
		);
		await collect(streamProse({ ...proseInput, endpoints: [endpoint()] }));
		expect(parseLog(warn.mock.calls[0][0]).reason).toBe('response_too_large');
		warn.mockClear();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				responseFrom(['data: {"choices":[{"delta":{"content":"kept"}}]}\n\n', 'x'.repeat(500)])
			)
		);
		await expect(
			collect(streamProse({ ...proseInput, endpoints: [endpoint()] }))
		).rejects.toMatchObject({ reason: 'response_too_large', diagnosticLogged: true });
		expect(warn).toHaveBeenCalledTimes(1);
		expect(parseLog(warn.mock.calls[0][0]).reason).toBe('response_too_large');
	});

	it('logs timeout once before content and uses the deterministic fallback', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async (_url: URL | RequestInfo, init?: RequestInit) =>
					await new Promise<Response>((_resolve, reject) => {
						init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
							once: true
						});
					})
			)
		);
		const text = await collect(
			streamProse({ ...proseInput, endpoints: [{ ...endpoint(), timeoutMs: 5 }] })
		);
		expect(text).toContain('Watcher');
		expect(warn).toHaveBeenCalledTimes(1);
		expect(parseLog(warn.mock.calls[0][0]).reason).toBe('timeout');
	});

	it('logs timeout once after content and rethrows without appending fallback', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
				let sent = false;
				return new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason), {
								once: true
							});
						},
						pull(controller) {
							if (!sent) {
								sent = true;
								controller.enqueue(
									encoder.encode('data: {"choices":[{"delta":{"content":"kept"}}]}\n\n')
								);
							}
						}
					}),
					{ status: 200 }
				);
			})
		);
		const seen: string[] = [];
		await expect(
			(async () => {
				for await (const chunk of streamProse({
					...proseInput,
					endpoints: [{ ...endpoint(), timeoutMs: 5 }]
				}))
					seen.push(chunk.content);
			})()
		).rejects.toMatchObject({ reason: 'timeout', diagnosticLogged: true });
		expect(seen.join('')).toBe('kept');
		expect(warn).toHaveBeenCalledTimes(1);
		expect(parseLog(warn.mock.calls[0][0]).reason).toBe('timeout');
	});

	it('classifies manual redirects before generic HTTP errors', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(null, { status: 302 }))
		);
		await collect(streamProse({ ...proseInput, endpoints: [endpoint()] }));
		expect(parseLog(warn.mock.calls[0][0]).reason).toBe('redirect_rejected');
	});

	it('wraps key decryption failures without exposing ciphertext or crypto errors', async () => {
		const ciphertext = 'secret-malformed-ciphertext';
		await collect(
			streamProse({ ...proseInput, endpoints: [{ ...endpoint(), apiKeyEnc: ciphertext }] })
		);
		expect(parseLog(warn.mock.calls[0][0]).reason).toBe('key_decryption');
		expect(String(warn.mock.calls[0][0])).not.toContain(ciphertext);
	});

	it.each(['client_disconnect', 'lease_lost'] as const)(
		'suppresses fallback and diagnostics for an external %s abort',
		async (reason) => {
			const aborter = new AbortController();
			aborter.abort(new LlmFailure(reason, 'typed route abort'));
			await expect(
				collect(
					streamProse({
						...proseInput,
						endpoints: [endpoint()],
						signal: aborter.signal
					})
				)
			).rejects.toMatchObject({ reason });
			expect(warn).not.toHaveBeenCalled();
		}
	);

	it('logs the classified reason for a pre-output HTTP failure', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('boom', { status: 503 }))
		);
		const onFallbackDiagnostic = vi.fn();
		await collect(streamProse({ ...proseInput, endpoints: [endpoint()], onFallbackDiagnostic }));
		expect(warn).toHaveBeenCalledTimes(1);
		expect(onFallbackDiagnostic).toHaveBeenCalledTimes(1);
		const payload = parseLog(warn.mock.calls[0][0]);
		expect(payload.reason).toBe('http_status');
		expect(payload.status).toBe(503);
	});

	it('logs once for a non-streaming runPurpose fallback with no endpoints', async () => {
		await narrateProse({ ...proseInput, endpoints: [] });
		expect(warn).toHaveBeenCalledTimes(1);
		const payload = parseLog(warn.mock.calls[0][0]);
		expect(payload.reason).toBe('no_enabled_endpoint');
		expect(payload.mode).toBe('non_stream');
		expect(payload.configuredMaxTokens).toBe(config.LLM_MAX_TOKENS);
		expect(payload.configuredResponseByteLimit).toBe(config.LLM_MAX_RESPONSE_BYTES);
	});

	it('logs invalid_structured_response when an endpoint answer cannot be interpreted', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				responseFrom(['data: {"choices":[{"message":{"content":"not an interpretation"}}]}'])
			)
		);
		await interpretAction({
			system: 'system',
			room: { type: 'monster', name: 'Watcher' },
			actionText: 'attack',
			endpoints: [{ ...endpoint(), purpose: 'interpretation' }],
			diagnostics: {
				correlationId: '44444444-4444-4444-8444-444444444444',
				runId: '55555555-5555-4555-8555-555555555555'
			}
		});
		expect(warn).toHaveBeenCalledTimes(1);
		const payload = parseLog(warn.mock.calls[0][0]);
		expect(payload.reason).toBe('invalid_structured_response');
		expect(payload.mode).toBe('non_stream');
		expect(payload.correlationId).toBe('44444444-4444-4444-8444-444444444444');
		expect(payload.runId).toBe('55555555-5555-4555-8555-555555555555');
	});

	it('propagates one request correlation through suggestion fallback diagnostics', async () => {
		await suggestActions({
			system: 'system',
			room: { type: 'rest', name: 'Long Hall' },
			endpoints: [],
			diagnostics: {
				correlationId: '66666666-6666-4666-8666-666666666666',
				runId: '77777777-7777-4777-8777-777777777777'
			}
		});
		expect(warn).toHaveBeenCalledTimes(1);
		const payload = parseLog(warn.mock.calls[0][0]);
		expect(payload.correlationId).toBe('66666666-6666-4666-8666-666666666666');
		expect(payload.runId).toBe('77777777-7777-4777-8777-777777777777');
	});

	it('emits no diagnostics when the flag is disabled', async () => {
		config.LLM_DIAGNOSTICS = false;
		await collect(streamProse({ ...proseInput, endpoints: [] }));
		expect(warn).not.toHaveBeenCalled();
	});
});
