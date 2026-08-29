import { z } from 'zod';
import {
	SKILLS,
	type InventoryItem,
	type LlmPurpose,
	type RoomSnapshot,
	type SuggestedAction,
	type TurnOutcome
} from '$lib/types';
import { config } from './config';
import { decryptEndpointKey } from './crypto';
import { validateLlmUrl, validateResolvedLlmUrl } from './validation';
import {
	composeInterpretation,
	composeProse,
	composeRoomEntry,
	composeSuggestions,
	composeSummary,
	delimit
} from './prompts';
import type { RoomEntryCharacterProfile } from './prompts';
import { mapActionIntent, normalizeActionIntent, type MappedIntent } from './game';

/*
 * Bounded, OpenAI-compatible LLM access. Endpoints are tried in name order
 * per purpose; any failure falls through to the next enabled endpoint and
 * finally to a deterministic fallback. These functions are pure: they never
 * mutate game state.
 */

export interface EndpointSource {
	name: string;
	purpose: LlmPurpose;
	baseUrl: string;
	model: string;
	apiKeyEnc: string | null;
	enabled: boolean;
	timeoutMs: number;
}

/** First enabled endpoint for a purpose, ordered by name; undefined when none. */
export function pickEndpoint(
	endpoints: readonly EndpointSource[],
	purpose: LlmPurpose
): EndpointSource | undefined {
	return [...endpoints]
		.filter((e) => e.enabled && e.purpose === purpose)
		.sort((a, b) => a.name.localeCompare(b.name))[0];
}

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface LlmCallOptions {
	maxTokens?: number;
	timeoutMs?: number;
	signal?: AbortSignal;
}

/** Reads at most `limit` bytes from a web stream, reporting truncation. */
async function readBounded(
	body: ReadableStream<Uint8Array> | null,
	limit: number
): Promise<{ text: string; truncated: boolean }> {
	if (!body) return { text: '', truncated: false };
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	let truncated = false;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value && value.length > 0) {
				const remaining = limit - total;
				if (remaining <= 0) {
					truncated = true;
					await reader.cancel();
					break;
				}
				const slice = value.length > remaining ? value.subarray(0, remaining) : value;
				chunks.push(slice);
				total += slice.length;
				if (value.length > remaining) {
					truncated = true;
					await reader.cancel();
					break;
				}
			}
		}
	} catch (error) {
		try {
			await reader.cancel();
		} catch {
			// Preserve the original read or abort error.
		}
		throw error;
	} finally {
		reader.releaseLock();
	}
	return { text: Buffer.concat(chunks).toString('utf8'), truncated };
}

/**
 * Calls one OpenAI-compatible /chat/completions endpoint. Never follows
 * redirects, honours an abort timeout, bounds the response read and sets a
 * finite max_tokens. Throws on any failure so callers can fall through.
 */
export async function callChat(
	endpoint: EndpointSource,
	messages: ChatMessage[],
	opts: LlmCallOptions = {}
): Promise<string> {
	const timeoutMs = opts.timeoutMs ?? endpoint.timeoutMs ?? config.LLM_TIMEOUT_MS;
	const maxTokens = opts.maxTokens ?? config.LLM_MAX_TOKENS;

	const controller = new AbortController();
	const signal = opts.signal
		? AbortSignal.any([controller.signal, opts.signal])
		: controller.signal;
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	let response: Response | undefined;
	try {
		const baseUrl = endpoint.baseUrl.replace(/\/+$/, '');
		const candidateUrl = validateLlmUrl(`${baseUrl}/chat/completions`);
		let apiKey: string | undefined;
		if (endpoint.apiKeyEnc) apiKey = decryptEndpointKey(endpoint.apiKeyEnc);

		// Resolve and re-check immediately before fetch. Native fetch cannot pin that
		// address, so deployment-level egress controls remain necessary.
		const url = await validateResolvedLlmUrl(candidateUrl.toString());
		signal.throwIfAborted();
		response = await fetch(url, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
			},
			body: JSON.stringify({
				model: endpoint.model,
				messages,
				max_tokens: maxTokens,
				temperature: 0.7,
				stream: false
			}),
			redirect: 'manual',
			signal
		});

		if (response.type === 'opaqueredirect') {
			throw new Error('Endpoint returned a redirect; redirects are not followed');
		}
		if (!response.ok) {
			throw new Error(`Endpoint responded with status ${response.status}`);
		}
		const { text, truncated } = await readBounded(response.body, config.LLM_MAX_RESPONSE_BYTES);
		if (truncated) throw new Error('Endpoint response exceeded the bounded read limit');

		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			throw new Error('Endpoint response was not valid JSON');
		}
		const content = (parsed as { choices?: Array<{ message?: { content?: unknown } }> })
			?.choices?.[0]?.message?.content;
		if (typeof content !== 'string') {
			throw new Error('Endpoint response was missing message content');
		}
		return content;
	} catch (error) {
		if (response?.body) {
			try {
				await response.body.cancel();
			} catch {
				// The reader may already have canceled or consumed the body.
			}
		}
		controller.abort();
		throw error;
	} finally {
		clearTimeout(timer);
	}
}

/* ------------------------------------------------------------------ *
 * OpenAI-compatible SSE streaming
 * ------------------------------------------------------------------ */

export interface SseEvent {
	data: string;
	event?: string;
}

export interface StreamChunk {
	content: string;
	done: boolean;
}

const SSE_MAX_DECODE_BYTES = 1024 * 1024;

/** Streaming decoder for the SSE wire format used by OpenAI-compatible chat endpoints. */
export class OpenAiSseDecoder {
	private readonly decoder = new TextDecoder();
	private buffer = '';
	private pendingData: string[] = [];
	private pendingEvent: string | undefined;

	/** Feed raw bytes; returns every complete event decoded from the new data. */
	push(chunk: Uint8Array): SseEvent[] {
		this.buffer += this.decoder.decode(chunk, { stream: true });
		if (Buffer.byteLength(this.buffer, 'utf8') > SSE_MAX_DECODE_BYTES) {
			throw new Error('SSE stream exceeded the bounded decode buffer');
		}
		return this.drain();
	}

	/** Emits any trailing partial event when the stream ends mid-event. */
	flush(): SseEvent[] {
		this.buffer += this.decoder.decode();
		// A terminal CR is itself a valid line ending; during push it is held so a
		// CRLF split across chunks is not mistaken for two line endings.
		if (this.buffer.endsWith('\r')) this.buffer += '\n';
		const events = this.drain();
		if (this.buffer.length > 0) {
			this.consumeLine(this.buffer);
			this.buffer = '';
		}
		if (this.pendingData.length > 0) {
			events.push({ data: this.pendingData.join('\n'), event: this.pendingEvent });
			this.pendingData = [];
			this.pendingEvent = undefined;
		}
		return events;
	}

	private drain(): SseEvent[] {
		const events: SseEvent[] = [];
		for (;;) {
			const end = this.findLineEnd(this.buffer);
			if (end.index < 0) break;
			const line = this.buffer.slice(0, end.index);
			this.buffer = this.buffer.slice(end.next);
			if (line.length === 0) {
				if (this.pendingData.length > 0) {
					events.push({ data: this.pendingData.join('\n'), event: this.pendingEvent });
					this.pendingData = [];
					this.pendingEvent = undefined;
				}
				continue;
			}
			this.consumeLine(line);
		}
		return events;
	}

	private consumeLine(line: string): void {
		if (line.startsWith(':')) return;
		const colon = line.indexOf(':');
		const field = colon < 0 ? line : line.slice(0, colon);
		const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
		if (field === 'data') this.pendingData.push(value);
		else if (field === 'event') this.pendingEvent = value;
	}

	private findLineEnd(text: string): { index: number; next: number } {
		for (let i = 0; i < text.length; i++) {
			const ch = text.charCodeAt(i);
			if (ch === 10) return { index: i, next: i + 1 };
			if (ch === 13) {
				if (i + 1 === text.length) return { index: -1, next: 0 };
				if (text.charCodeAt(i + 1) === 10) return { index: i, next: i + 2 };
				return { index: i, next: i + 1 };
			}
		}
		return { index: -1, next: 0 };
	}
}

/** Parses one SSE event into the OpenAI chat delta content; `[DONE]` marks the end. */
export function parseSseChunk(event: SseEvent): StreamChunk {
	const trimmed = event.data.trim();
	if (trimmed === '[DONE]') return { content: '', done: true };
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return { content: '', done: false };
	}
	const content = (parsed as { choices?: Array<{ delta?: { content?: unknown } }> })?.choices?.[0]
		?.delta?.content;
	return { content: typeof content === 'string' ? content : '', done: false };
}

/**
 * Calls one OpenAI-compatible /chat/completions endpoint in streaming mode and
 * yields decoded text deltas. Preserves the same URL, SSRF, redirect, auth,
 * timeout, response-byte and abort guarantees as `callChat`. Throws on any
 * upstream failure so callers can apply fallback policies.
 */
export async function* callChatStream(
	endpoint: EndpointSource,
	messages: ChatMessage[],
	opts: LlmCallOptions = {}
): AsyncGenerator<StreamChunk> {
	const timeoutMs = opts.timeoutMs ?? endpoint.timeoutMs ?? config.LLM_TIMEOUT_MS;
	const maxTokens = opts.maxTokens ?? config.LLM_MAX_TOKENS;

	const controller = new AbortController();
	const signal = opts.signal
		? AbortSignal.any([controller.signal, opts.signal])
		: controller.signal;
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	let response: Response | undefined;
	try {
		const baseUrl = endpoint.baseUrl.replace(/\/+$/, '');
		const candidateUrl = validateLlmUrl(`${baseUrl}/chat/completions`);
		let apiKey: string | undefined;
		if (endpoint.apiKeyEnc) apiKey = decryptEndpointKey(endpoint.apiKeyEnc);

		const url = await validateResolvedLlmUrl(candidateUrl.toString());
		signal.throwIfAborted();
		response = await fetch(url, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
			},
			body: JSON.stringify({
				model: endpoint.model,
				messages,
				max_tokens: maxTokens,
				temperature: 0.7,
				stream: true
			}),
			redirect: 'manual',
			signal
		});

		if (response.type === 'opaqueredirect') {
			throw new Error('Endpoint returned a redirect; redirects are not followed');
		}
		if (!response.ok) {
			throw new Error(`Endpoint responded with status ${response.status}`);
		}
		if (!response.body) {
			throw new Error('Endpoint returned an empty response body');
		}

		const reader = response.body.getReader();
		const decoder = new OpenAiSseDecoder();
		let totalBytes = 0;
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				if (value && value.length > 0) {
					totalBytes += value.length;
					if (totalBytes > config.LLM_MAX_RESPONSE_BYTES) {
						throw new Error('Endpoint stream exceeded the bounded read limit');
					}
					for (const event of decoder.push(value)) {
						const chunk = parseSseChunk(event);
						if (chunk.done) return;
						if (chunk.content) yield chunk;
					}
				}
			}
			for (const event of decoder.flush()) {
				const chunk = parseSseChunk(event);
				if (chunk.done) return;
				if (chunk.content) yield chunk;
			}
		} finally {
			try {
				await reader.cancel();
			} catch {
				// Reader already closed.
			}
			reader.releaseLock();
		}
	} catch (error) {
		if (response?.body) {
			try {
				await response.body.cancel();
			} catch {
				// Already canceled or consumed.
			}
		}
		controller.abort();
		throw error;
	} finally {
		clearTimeout(timer);
	}
}

/** Tries enabled endpoints for a purpose in name order, then the fallback. */
async function runPurpose(
	purpose: LlmPurpose,
	endpoints: readonly EndpointSource[],
	messages: ChatMessage[],
	fallback: string,
	opts: LlmCallOptions = {}
): Promise<string> {
	const candidates = [...endpoints]
		.filter((e) => e.enabled && e.purpose === purpose)
		.sort((a, b) => a.name.localeCompare(b.name));
	let lastError: unknown;
	for (const endpoint of candidates) {
		try {
			return await callChat(endpoint, messages, opts);
		} catch (err) {
			lastError = err;
		}
	}
	if (candidates.length > 0) {
		// Record the failure reason but always keep the fallback available.
		void lastError;
	}
	return fallback;
}

/* ------------------------------------------------------------------ *
 * Structured output schemas (bounded shapes)
 * ------------------------------------------------------------------ */

const interpretationSchema = z.object({
	approach: z.enum(['skill', 'combat', 'none']),
	skill: z
		.enum(['Athletics', 'Knowledge', 'Magic', 'Persuasion', 'Stealth', 'Willpower'])
		.optional(),
	advantage: z.number().int().min(-2).max(2).default(0)
});

const suggestionSchema = z.object({
	label: z.string().min(1).max(80),
	detail: z.string().max(200),
	typed: z.string().max(200)
});

const suggestionsSchema = z.array(suggestionSchema).min(0).max(3);

/** Parses model JSON into the bounded intent shape; throws on malformed input. */
export function parseInterpretation(content: string): MappedIntent {
	let trimmed = content.trim();
	trimmed = trimmed
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/\s*```$/, '')
		.trim();
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		throw new Error('Interpretation response was not valid JSON');
	}
	const result = interpretationSchema.safeParse(parsed);
	if (!result.success)
		throw new Error('Interpretation response did not match the bounded intent shape');
	return {
		approach: result.data.approach,
		skill: result.data.skill,
		advantage: result.data.advantage
	};
}

/** Parses model JSON into the bounded suggestion list; throws on malformed input. */
export function parseSuggestions(content: string): SuggestedAction[] {
	let trimmed = content.trim();
	trimmed = trimmed
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/\s*```$/, '')
		.trim();
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		throw new Error('Suggestions response was not valid JSON');
	}
	const result = suggestionsSchema.safeParse(parsed);
	if (!result.success)
		throw new Error('Suggestions response did not match the bounded suggestion shape');
	return result.data;
}

/* ------------------------------------------------------------------ *
 * Deterministic fallbacks
 * ------------------------------------------------------------------ */

export function fallbackProse(
	room: RoomSnapshot,
	actionText: string,
	outcome: TurnOutcome
): string {
	const noun = room.name ?? `the ${room.type}`;
	switch (room.type) {
		case 'monster':
		case 'boss':
			return outcome.result === 'success' || outcome.result === 'reward'
				? `You press your attack and ${noun} is brought down before you.`
				: `The clash with ${noun} goes against you and you come away wounded.`;
		case 'trap':
			return outcome.result === 'success' || outcome.result === 'reward'
				? `You thread your way past ${noun} without harm.`
				: `${noun} catches you and you take a wound.`;
		case 'treasure':
			return `You search ${noun} and ${outcome.result === 'reward' ? 'come away with spoils' : 'find it guarded against you'}.`;
		case 'rest':
			return `You settle into ${noun} and rest, feeling steadier for it.`;
	}
}

/** Deterministic room-entry prose used when no upstream endpoint can respond. */
export function fallbackRoomEntry(room: RoomSnapshot, runSummary: string): string {
	const noun = room.name ?? `the ${room.type}`;
	const entry = room.description?.trim()
		? `You step into ${noun}. ${room.description.trim()}`
		: `You step into ${noun} and take in the chamber around you.`;
	if (runSummary.trim()) return `${entry}\n\n${runSummary.trim()}`;
	return entry;
}

/** Deterministic fallback prose as a stream of visible text chunks. */
export async function* fallbackProseStream(
	room: RoomSnapshot,
	actionText: string,
	outcome: TurnOutcome
): AsyncGenerator<StreamChunk> {
	const text = fallbackProse(room, actionText, outcome);
	yield* chunkFallback(text);
}

/** Deterministic fallback room entry as a stream of visible text chunks. */
export async function* fallbackRoomEntryStream(
	room: RoomSnapshot,
	runSummary: string
): AsyncGenerator<StreamChunk> {
	const text = fallbackRoomEntry(room, runSummary);
	yield* chunkFallback(text);
}

/** Stable visible chunks keep fallback behavior stream-like without timing or randomness. */
async function* chunkFallback(text: string): AsyncGenerator<StreamChunk> {
	const size = 48;
	for (let offset = 0; offset < text.length; offset += size) {
		yield { content: text.slice(offset, offset + size), done: false };
	}
}

export function fallbackSummary(
	room: RoomSnapshot,
	actionText: string,
	outcome: TurnOutcome
): string {
	const hp =
		outcome.hpDelta >= 0
			? `You recovered ${outcome.hpDelta} HP.`
			: `You lost ${Math.abs(outcome.hpDelta)} HP.`;
	const what = actionText.trim() ? `You ${actionText.trim()}.` : `You dealt with the ${room.type}.`;
	return `${what} ${hp}`;
}

export function fallbackSuggestions(room: RoomSnapshot): SuggestedAction[] {
	switch (room.type) {
		case 'monster':
		case 'boss':
			return [
				{
					label: 'Fight',
					detail: 'Close with the enemy and strike.',
					typed: 'I attack with all my strength.'
				},
				{
					label: 'Bargain',
					detail: 'Try to talk your way past.',
					typed: 'I try to persuade it to let me pass.'
				},
				{
					label: 'Slip away',
					detail: 'Move quietly to avoid a fight.',
					typed: 'I sneak past without being seen.'
				}
			];
		case 'trap':
			return [
				{
					label: 'Disarm',
					detail: 'Carefully work past the trap.',
					typed: 'I focus and pick my way through.'
				},
				{
					label: 'Smash',
					detail: 'Force through by main strength.',
					typed: 'I batter the trap apart.'
				},
				{
					label: 'Read',
					detail: 'Study the mechanism first.',
					typed: 'I study the mechanism before acting.'
				}
			];
		case 'treasure':
			return [
				{ label: 'Claim', detail: 'Take one reward.', typed: 'I claim the treasure.' },
				{
					label: 'Search',
					detail: 'Look through the cache for your reward.',
					typed: 'I carefully search the treasure cache.'
				}
			];
		case 'rest':
			return [{ label: 'Rest', detail: 'Recover 1 HP.', typed: 'I rest here.' }];
	}
}

/* ------------------------------------------------------------------ *
 * Purpose helpers (all fall back deterministically, never mutate state)
 * ------------------------------------------------------------------ */

export interface ProseInput {
	system: string;
	room: RoomSnapshot;
	actionText: string;
	outcome: TurnOutcome;
	endpoints: readonly EndpointSource[];
	signal?: AbortSignal;
}

/** Fetches prose narration for a resolved turn, or deterministic prose. */
export async function narrateProse(input: ProseInput): Promise<string> {
	const { system, room, actionText, outcome } = input;
	const prompt = composeProse({ system, room, actionText, outcome });
	return runPurpose(
		'prose',
		input.endpoints,
		[
			{ role: 'system', content: prompt.system },
			{ role: 'user', content: prompt.user }
		],
		fallbackProse(room, actionText, outcome)
	);
}

/**
 * Streams prose narration for a resolved turn. Uses the first enabled prose
 * endpoint by name; a deterministic fallback is used only when no endpoint
 * exists or the upstream fails before emitting any text. Once text has been
 * emitted, an upstream error terminates the stream rather than appending
 * fallback prose.
 */
export async function* streamProse(input: ProseInput): AsyncGenerator<StreamChunk> {
	const { system, room, actionText, outcome } = input;
	const endpoint = pickEndpoint(input.endpoints, 'prose');
	if (!endpoint) {
		yield* fallbackProseStream(room, actionText, outcome);
		return;
	}
	const prompt = composeProse({ system, room, actionText, outcome });
	let emitted = false;
	try {
		for await (const chunk of callChatStream(
			endpoint,
			[
				{ role: 'system', content: prompt.system },
				{ role: 'user', content: prompt.user }
			],
			{ signal: input.signal }
		)) {
			if (chunk.done) return;
			if (chunk.content) {
				emitted = true;
				yield chunk;
			}
		}
	} catch (error) {
		if (emitted) throw error;
		yield* fallbackProseStream(room, actionText, outcome);
		return;
	}
	if (!emitted) yield* fallbackProseStream(room, actionText, outcome);
}

export interface RoomEntryStreamInput {
	system: string;
	room: RoomSnapshot;
	runSummary: string;
	character: RoomEntryCharacterProfile;
	inventory: InventoryItem[];
	endpoints: readonly EndpointSource[];
	signal?: AbortSignal;
}

/**
 * Streams room-entry prose for an entering adventurer with the same fallback
 * policy as {@link streamProse}.
 */
export async function* streamRoomEntry(input: RoomEntryStreamInput): AsyncGenerator<StreamChunk> {
	const { system, room, runSummary, character, inventory } = input;
	const endpoint = pickEndpoint(input.endpoints, 'prose');
	if (!endpoint) {
		yield* fallbackRoomEntryStream(room, runSummary);
		return;
	}
	const prompt = composeRoomEntry({
		system,
		room,
		runSummary,
		character,
		inventory
	});
	let emitted = false;
	try {
		for await (const chunk of callChatStream(
			endpoint,
			[
				{ role: 'system', content: prompt.system },
				{ role: 'user', content: prompt.user }
			],
			{ signal: input.signal }
		)) {
			if (chunk.done) return;
			if (chunk.content) {
				emitted = true;
				yield chunk;
			}
		}
	} catch (error) {
		if (emitted) throw error;
		yield* fallbackRoomEntryStream(room, runSummary);
		return;
	}
	if (!emitted) yield* fallbackRoomEntryStream(room, runSummary);
}

export interface InterpretationInput {
	system: string;
	room: RoomSnapshot;
	actionText: string;
	endpoints: readonly EndpointSource[];
}

/** Parses the player action into the bounded intent; falls back to the heuristic mapper. */
export async function interpretAction(input: InterpretationInput): Promise<MappedIntent> {
	const { system, room, actionText } = input;
	const prompt = composeInterpretation({ system, room, actionText });
	const fallback = mapActionIntent({ text: actionText, room });
	const content = await runPurpose(
		'interpretation',
		input.endpoints,
		[
			{ role: 'system', content: prompt.system },
			{ role: 'user', content: prompt.user }
		],
		JSON.stringify(fallback)
	);
	try {
		return normalizeActionIntent(room, parseInterpretation(content));
	} catch {
		return fallback;
	}
}

export interface SummaryInput {
	system: string;
	room: RoomSnapshot;
	actionText: string;
	outcome: TurnOutcome;
	endpoints: readonly EndpointSource[];
}

/** Fetches a short turn summary, or deterministic summary. */
export async function summarizeTurn(input: SummaryInput): Promise<string> {
	const { system, room, actionText, outcome } = input;
	const prompt = composeSummary({ system, room, actionText, outcome });
	return runPurpose(
		'summary',
		input.endpoints,
		[
			{ role: 'system', content: prompt.system },
			{ role: 'user', content: prompt.user }
		],
		fallbackSummary(room, actionText, outcome)
	);
}

export interface SuggestionsInput {
	system: string;
	room: RoomSnapshot;
	endpoints: readonly EndpointSource[];
}

/** Fetches up to three suggested actions, or deterministic suggestions. */
export async function suggestActions(input: SuggestionsInput): Promise<SuggestedAction[]> {
	const { system, room } = input;
	const prompt = composeSuggestions({ system, room });
	const fallback = fallbackSuggestions(room);
	const content = await runPurpose(
		'suggestions',
		input.endpoints,
		[
			{ role: 'system', content: prompt.system },
			{ role: 'user', content: prompt.user }
		],
		JSON.stringify(fallback)
	);
	try {
		return parseSuggestions(content);
	} catch {
		return fallback;
	}
}

/** Wraps a piece of untrusted text for embedding in a user message. */
export function embedUntrusted(label: string, content: string): string {
	return delimit(label, content);
}

/** Convenience guard so callers can check a skill name is one of the six. */
export function isSkillName(value: string): value is (typeof SKILLS)[number] {
	return (SKILLS as readonly string[]).includes(value);
}
