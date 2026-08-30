import { z } from 'zod';
import {
	SKILLS,
	type InventoryItem,
	type LlmPurpose,
	type RollRecord,
	type RoomSnapshot,
	type SuggestedAction,
	type TurnOutcome
} from '$lib/types';
import { config } from './config';
import { decryptEndpointKey } from './crypto';
import {
	classifyLlmFailure,
	contextFields,
	LlmFailure,
	logLlmFallback,
	toLlmFailure,
	type LlmDiagnosticContext,
	type LlmStreamStats
} from './llm-diagnostics';
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
	id?: string;
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
	/** Receives cumulative stream metrics for fallback diagnostics; must never throw. */
	onStats?: (stats: LlmStreamStats) => void;
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
	const timer = setTimeout(
		() => controller.abort(new LlmFailure('timeout', 'LLM request timed out')),
		timeoutMs
	);
	let response: Response | undefined;
	try {
		const baseUrl = endpoint.baseUrl.replace(/\/+$/, '');
		const candidateUrl = validateLlmUrl(`${baseUrl}/chat/completions`);
		let apiKey: string | undefined;
		if (endpoint.apiKeyEnc) {
			try {
				apiKey = decryptEndpointKey(endpoint.apiKeyEnc);
			} catch {
				throw new LlmFailure('key_decryption', 'Endpoint key could not be decrypted');
			}
		}

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

		if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
			throw new LlmFailure(
				'redirect_rejected',
				'Endpoint returned a redirect; redirects are not followed'
			);
		}
		if (!response.ok) {
			throw new LlmFailure('http_status', `Endpoint responded with status ${response.status}`, {
				status: response.status
			});
		}
		if (!response.body) {
			throw new LlmFailure('missing_body', 'Endpoint returned an empty response body');
		}
		const { text, truncated } = await readBounded(response.body, config.LLM_MAX_RESPONSE_BYTES);
		if (truncated)
			throw new LlmFailure(
				'response_too_large',
				'Endpoint response exceeded the bounded read limit'
			);

		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			throw new LlmFailure('invalid_structured_response', 'Endpoint response was not valid JSON');
		}
		const content = (parsed as { choices?: Array<{ message?: { content?: unknown } }> })
			?.choices?.[0]?.message?.content;
		if (typeof content !== 'string') {
			throw new LlmFailure(
				'invalid_structured_response',
				'Endpoint response was missing message content'
			);
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
		const failure = toLlmFailure(signal.aborted ? signal.reason : error, 'network_error');
		controller.abort();
		throw failure;
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
			throw new LlmFailure('decoder_limit', 'SSE stream exceeded the bounded decode buffer');
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

/**
 * Parses one SSE event into the OpenAI chat delta content; `[DONE]` marks the
 * end. `malformed` is true when the event data could not be decoded as the
 * expected delta shape (used only for diagnostics counting).
 */
function decodeSseChunk(event: SseEvent): { chunk: StreamChunk; malformed: boolean } {
	const trimmed = event.data.trim();
	if (trimmed === '[DONE]') return { chunk: { content: '', done: true }, malformed: false };
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return { chunk: { content: '', done: false }, malformed: true };
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return { chunk: { content: '', done: false }, malformed: true };
	}
	const payload = parsed as Record<string, unknown>;
	if (!Array.isArray(payload.choices)) {
		return { chunk: { content: '', done: false }, malformed: true };
	}
	if (payload.choices.length === 0) {
		const metadata =
			typeof payload.id === 'string' ||
			typeof payload.object === 'string' ||
			typeof payload.created === 'number' ||
			typeof payload.model === 'string' ||
			(payload.usage !== null && typeof payload.usage === 'object');
		return { chunk: { content: '', done: false }, malformed: !metadata };
	}
	const choice = payload.choices[0];
	if (!choice || typeof choice !== 'object' || Array.isArray(choice)) {
		return { chunk: { content: '', done: false }, malformed: true };
	}
	const record = choice as Record<string, unknown>;
	const delta = record.delta;
	if (delta && typeof delta === 'object' && !Array.isArray(delta)) {
		const deltaRecord = delta as Record<string, unknown>;
		if (typeof deltaRecord.content === 'string') {
			return { chunk: { content: deltaRecord.content, done: false }, malformed: false };
		}
		if (typeof deltaRecord.role === 'string') {
			return { chunk: { content: '', done: false }, malformed: false };
		}
	}
	if (typeof record.finish_reason === 'string') {
		return { chunk: { content: '', done: false }, malformed: false };
	}
	return { chunk: { content: '', done: false }, malformed: true };
}

/** Parses one SSE event into the OpenAI chat delta content; `[DONE]` marks the end. */
export function parseSseChunk(event: SseEvent): StreamChunk {
	return decodeSseChunk(event).chunk;
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
	const timer = setTimeout(
		() => controller.abort(new LlmFailure('timeout', 'LLM stream timed out')),
		timeoutMs
	);
	let response: Response | undefined;
	try {
		const baseUrl = endpoint.baseUrl.replace(/\/+$/, '');
		const candidateUrl = validateLlmUrl(`${baseUrl}/chat/completions`);
		let apiKey: string | undefined;
		if (endpoint.apiKeyEnc) {
			try {
				apiKey = decryptEndpointKey(endpoint.apiKeyEnc);
			} catch {
				throw new LlmFailure('key_decryption', 'Endpoint key could not be decrypted');
			}
		}

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

		if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
			throw new LlmFailure(
				'redirect_rejected',
				'Endpoint returned a redirect; redirects are not followed'
			);
		}
		if (!response.ok) {
			throw new LlmFailure('http_status', `Endpoint responded with status ${response.status}`, {
				status: response.status
			});
		}
		if (!response.body) {
			throw new LlmFailure('missing_body', 'Endpoint returned an empty response body');
		}

		const reader = response.body.getReader();
		const decoder = new OpenAiSseDecoder();
		let totalBytes = 0;
		let sseEvents = 0;
		let parseFailures = 0;
		let contentDeltas = 0;
		const reportStats = () => {
			if (!opts.onStats) return;
			try {
				opts.onStats({ bytes: totalBytes, sseEvents, parseFailures, contentDeltas });
			} catch {
				// Statistics must never break the stream.
			}
		};
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				if (value && value.length > 0) {
					totalBytes += value.length;
					if (totalBytes > config.LLM_MAX_RESPONSE_BYTES) {
						throw new LlmFailure(
							'response_too_large',
							'Endpoint stream exceeded the bounded read limit'
						);
					}
					for (const event of decoder.push(value)) {
						sseEvents++;
						const { chunk, malformed } = decodeSseChunk(event);
						if (malformed) parseFailures++;
						if (chunk.done) return;
						if (chunk.content) {
							contentDeltas++;
							yield chunk;
						}
					}
				}
			}
			for (const event of decoder.flush()) {
				sseEvents++;
				const { chunk, malformed } = decodeSseChunk(event);
				if (malformed) parseFailures++;
				if (chunk.done) return;
				if (chunk.content) {
					contentDeltas++;
					yield chunk;
				}
			}
		} finally {
			try {
				await reader.cancel();
			} catch {
				// Reader already closed.
			}
			reader.releaseLock();
			reportStats();
		}
	} catch (error) {
		if (response?.body) {
			try {
				await response.body.cancel();
			} catch {
				// Already canceled or consumed.
			}
		}
		const failure = toLlmFailure(signal.aborted ? signal.reason : error, 'network_error');
		controller.abort();
		throw failure;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Tries enabled endpoints for a purpose in name order, then the fallback.
 * Emits exactly one fallback diagnostic after every candidate has failed or
 * when no endpoint is enabled for the purpose (never once per retry).
 */
async function runPurpose(
	purpose: LlmPurpose,
	endpoints: readonly EndpointSource[],
	messages: ChatMessage[],
	fallback: string,
	opts: LlmCallOptions = {},
	diagnostics?: LlmDiagnosticContext
): Promise<string> {
	const candidates = [...endpoints]
		.filter((e) => e.enabled && e.purpose === purpose)
		.sort((a, b) => a.name.localeCompare(b.name));
	let lastError: unknown;
	let lastEndpoint: EndpointSource | undefined;
	for (const endpoint of candidates) {
		lastEndpoint = endpoint;
		try {
			return await callChat(endpoint, messages, opts);
		} catch (err) {
			lastError = err;
		}
	}
	if (candidates.length === 0) {
		logLlmFallback({
			purpose,
			mode: 'non_stream',
			reason: 'no_enabled_endpoint',
			configuredTimeoutMs: opts.timeoutMs ?? config.LLM_TIMEOUT_MS,
			configuredMaxTokens: opts.maxTokens ?? config.LLM_MAX_TOKENS,
			configuredResponseByteLimit: config.LLM_MAX_RESPONSE_BYTES,
			visibleChars: fallback.length,
			...contextFields(diagnostics)
		});
	} else {
		logLlmFallback({
			purpose,
			mode: 'non_stream',
			reason: classifyLlmFailure(lastError),
			endpointId: lastEndpoint?.id,
			configuredTimeoutMs: opts.timeoutMs ?? lastEndpoint?.timeoutMs ?? config.LLM_TIMEOUT_MS,
			configuredMaxTokens: opts.maxTokens ?? config.LLM_MAX_TOKENS,
			configuredResponseByteLimit: config.LLM_MAX_RESPONSE_BYTES,
			...(lastError instanceof LlmFailure && lastError.status !== undefined
				? { status: lastError.status }
				: {}),
			visibleChars: fallback.length,
			...contextFields(diagnostics)
		});
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
	outcome: TurnOutcome,
	rolls: RollRecord[] = []
): string {
	const inline = (value: string, maxChars: number) =>
		value.replace(/\s+/g, ' ').trim().slice(0, maxChars);
	const noun = (room.name ? inline(room.name, 200) : '') || `the ${room.type}`;
	const action = actionText
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^I\s+/i, '')
		.replace(/[.!?]+$/, '')
		.trim();
	const submitted = action ? `You ${action}.` : 'You hold your ground.';
	// Strongest roll by total, else the first roll, else none.
	const primary = [...rolls].sort((a, b) => b.total - a.total)[0] ?? rolls[0];
	const margin = primary ? primary.total - primary.target : 0;
	const rollNote = primary
		? `The authoritative ${primary.label || 'check'} roll is ${primary.total} against ${primary.target}, ${
				Math.abs(margin) <= 1 ? 'a near result' : 'a wide result'
			} by ${Math.abs(margin)}.`
		: 'No roll is required.';
	const won = outcome.result === 'success' || outcome.result === 'reward';
	const hp =
		outcome.hpDelta < 0
			? `You lose ${Math.abs(outcome.hpDelta)} HP, falling from ${outcome.hpBefore} to ${outcome.hpAfter}.`
			: outcome.hpDelta > 0
				? `You recover ${outcome.hpDelta} HP, rising from ${outcome.hpBefore} to ${outcome.hpAfter}.`
				: `Your HP remains ${outcome.hpAfter}.`;
	const injury = outcome.injury
		? `The recorded injury is ${inline(outcome.injury, 500)}.`
		: 'No injury is recorded.';
	let scene: string;
	switch (room.type) {
		case 'monster':
		case 'boss':
			scene = won
				? `${noun} meets the attempt, but the exchange ends in your favor.`
				: `${noun} meets the attempt and forces the exchange against you.`;
			break;
		case 'trap':
			scene = won
				? `The mechanism of ${noun} is read correctly, and the hazard is overcome.`
				: `The mechanism of ${noun} answers the attempt before you can clear the hazard.`;
			break;
		case 'treasure':
			scene = `The cache of ${noun} yields only what the authoritative outcome grants.`;
			break;
		case 'rest':
			scene = `The shelter of ${noun} remains quiet while the authoritative outcome takes effect.`;
			break;
	}
	return `${submitted}\n\n${scene} ${inline(outcome.message, 2000)} ${rollNote} ${hp} ${injury}`.trim();
}

/** Deterministic room-entry prose used when no upstream endpoint can respond. */
export function fallbackRoomEntry(room: RoomSnapshot, runSummary: string): string {
	const inline = (value: string, maxChars: number) =>
		value.replace(/\s+/g, ' ').trim().slice(0, maxChars);
	const noun = (room.name ? inline(room.name, 200) : '') || `the ${room.type}`;
	const description = room.description ? inline(room.description, 2000) : '';
	const detail = description ? ` ${description}` : '';
	let setup = '';
	let reveal = '';
	switch (room.type) {
		case 'monster':
		case 'boss':
			setup =
				'The air grows heavy as you press deeper, the light thinning to a dull, uneven gloom. Dust hangs in the stillness, and the faint, sour scent of something large and patient reaches you before you see it.';
			reveal = `Then, out of the dark, ${noun} resolves itself and fills the space with its presence.${detail}`;
			break;
		case 'trap':
			setup =
				'You come into a chamber that feels wrong in small ways: a floor laid too evenly, a glint of wire at ankle height, stones set with unnatural care.';
			reveal = `Somewhere in the shadows ${noun} waits, still and ready.${detail}`;
			break;
		case 'treasure':
			setup =
				'A chamber opens before you, half-lit and oddly still, the dust along one wall disturbed by recent passage.';
			reveal = `There, half-concealed, sits ${noun}, waiting to be claimed.${detail}`;
			break;
		case 'rest':
			setup =
				'You find a sheltered alcove, quieter than the rest of the dungeon, the air softer and still.';
			reveal = `This is ${noun}, a place to catch your breath.${detail}`;
			break;
	}
	const history = inline(runSummary, 2000);
	return `${setup}\n\n${reveal}${history ? ` ${history}` : ''}`;
}

/** Deterministic fallback prose as a stream of visible text chunks. */
export async function* fallbackProseStream(
	room: RoomSnapshot,
	actionText: string,
	outcome: TurnOutcome,
	rolls: RollRecord[] = []
): AsyncGenerator<StreamChunk> {
	const text = fallbackProse(room, actionText, outcome, rolls);
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

/** Normalizes a submitted action into a second-person summary phrase. */
function normalizeSummaryAction(raw: string): string {
	const action = raw
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/[.!?]+$/, '')
		.trim();
	if (!action) return '';
	if (/^I\s+/i.test(action)) return `You ${action.replace(/^I\s+/i, '').trim()}.`;
	if (/^You\s+/i.test(action)) return `${action}.`;
	return `You attempt: ${action}.`;
}

export function fallbackSummary(
	room: RoomSnapshot,
	actionText: string,
	outcome: TurnOutcome
): string {
	const inline = (value: string, maxChars: number) =>
		value.replace(/\s+/g, ' ').trim().slice(0, maxChars);
	const what = normalizeSummaryAction(actionText) || `You dealt with the ${room.type}.`;
	const hp =
		outcome.hpDelta < 0
			? `You lost ${Math.abs(outcome.hpDelta)} HP.`
			: outcome.hpDelta > 0
				? `You recovered ${outcome.hpDelta} HP.`
				: 'Your HP was unchanged.';
	const injury = outcome.injury ? ` You were injured: ${inline(outcome.injury, 300)}.` : '';
	const reward =
		outcome.rewards && outcome.rewards.length > 0
			? ` You recovered ${outcome.rewards.length} item${outcome.rewards.length === 1 ? '' : 's'}.`
			: '';
	const message = outcome.message ? ` ${inline(outcome.message, 500)}` : '';
	return `${what}${message} ${hp}${injury}${reward}`.trim();
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
	/** Authoritative roll records; legacy or missing turns pass an empty list. */
	rolls?: RollRecord[];
	endpoints: readonly EndpointSource[];
	signal?: AbortSignal;
	/** Optional call-site context copied into fallback diagnostics. */
	diagnostics?: LlmDiagnosticContext;
	/** Notifies a route that this helper emitted and will return a deterministic fallback. */
	onFallbackDiagnostic?: () => void;
}

function notifyFallbackDiagnostic(callback: (() => void) | undefined): void {
	try {
		callback?.();
	} catch {
		// Diagnostic coordination must never interrupt deterministic fallback behavior.
	}
}

/** Fetches prose narration for a resolved turn, or deterministic prose. */
export async function narrateProse(input: ProseInput): Promise<string> {
	const { system, room, actionText, outcome, rolls } = input;
	const prompt = composeProse({ system, room, actionText, outcome, rolls });
	return runPurpose(
		'prose',
		input.endpoints,
		[
			{ role: 'system', content: prompt.system },
			{ role: 'user', content: prompt.user }
		],
		fallbackProse(room, actionText, outcome, rolls),
		{},
		input.diagnostics
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
	const { system, room, actionText, outcome, rolls } = input;
	const diagnostics = input.diagnostics;
	const endpoint = pickEndpoint(input.endpoints, 'prose');
	if (!endpoint) {
		const fallback = fallbackProse(room, actionText, outcome, rolls);
		logLlmFallback({
			purpose: 'prose',
			mode: 'stream',
			reason: 'no_enabled_endpoint',
			configuredTimeoutMs: config.LLM_TIMEOUT_MS,
			configuredMaxTokens: config.LLM_MAX_TOKENS,
			configuredResponseByteLimit: config.LLM_MAX_RESPONSE_BYTES,
			visibleChars: fallback.length,
			...contextFields(diagnostics)
		});
		notifyFallbackDiagnostic(input.onFallbackDiagnostic);
		yield* chunkFallback(fallback);
		return;
	}
	const prompt = composeProse({ system, room, actionText, outcome, rolls });
	const configuredTimeoutMs = endpoint.timeoutMs ?? config.LLM_TIMEOUT_MS;
	let visibleChars = 0;
	let stats: LlmStreamStats = { bytes: 0, sseEvents: 0, parseFailures: 0, contentDeltas: 0 };
	try {
		for await (const chunk of callChatStream(
			endpoint,
			[
				{ role: 'system', content: prompt.system },
				{ role: 'user', content: prompt.user }
			],
			{
				signal: input.signal,
				onStats: (s) => {
					stats = s;
				}
			}
		)) {
			if (chunk.done) return;
			if (chunk.content) {
				visibleChars += chunk.content.length;
				yield chunk;
			}
		}
	} catch (error) {
		const failure = toLlmFailure(error);
		if (failure.reason === 'client_disconnect' || failure.reason === 'lease_lost') throw failure;
		const fallback = fallbackProse(room, actionText, outcome, rolls);
		logLlmFallback({
			purpose: 'prose',
			mode: 'stream',
			reason: failure.reason,
			endpointId: endpoint.id,
			configuredTimeoutMs,
			configuredMaxTokens: config.LLM_MAX_TOKENS,
			configuredResponseByteLimit: config.LLM_MAX_RESPONSE_BYTES,
			...(failure.status !== undefined ? { status: failure.status } : {}),
			bytes: stats.bytes,
			sseEvents: stats.sseEvents,
			parseFailures: stats.parseFailures,
			contentDeltas: stats.contentDeltas,
			visibleChars: visibleChars > 0 ? visibleChars : fallback.length,
			...contextFields(diagnostics)
		});
		failure.diagnosticLogged = true;
		if (visibleChars > 0) throw failure;
		notifyFallbackDiagnostic(input.onFallbackDiagnostic);
		yield* chunkFallback(fallback);
		return;
	}
	if (visibleChars === 0) {
		const fallback = fallbackProse(room, actionText, outcome, rolls);
		logLlmFallback({
			purpose: 'prose',
			mode: 'stream',
			reason: stats.parseFailures > 0 ? 'stream_parse_error' : 'no_content_delta',
			endpointId: endpoint.id,
			configuredTimeoutMs,
			configuredMaxTokens: config.LLM_MAX_TOKENS,
			configuredResponseByteLimit: config.LLM_MAX_RESPONSE_BYTES,
			bytes: stats.bytes,
			sseEvents: stats.sseEvents,
			parseFailures: stats.parseFailures,
			contentDeltas: stats.contentDeltas,
			visibleChars: fallback.length,
			...contextFields(diagnostics)
		});
		notifyFallbackDiagnostic(input.onFallbackDiagnostic);
		yield* chunkFallback(fallback);
		return;
	}
}

export interface RoomEntryStreamInput {
	system: string;
	room: RoomSnapshot;
	runSummary: string;
	character: RoomEntryCharacterProfile;
	inventory: InventoryItem[];
	endpoints: readonly EndpointSource[];
	signal?: AbortSignal;
	/** Optional call-site context copied into fallback diagnostics. */
	diagnostics?: LlmDiagnosticContext;
	/** Notifies a route that this helper emitted and will return a deterministic fallback. */
	onFallbackDiagnostic?: () => void;
}

/**
 * Streams room-entry prose for an entering adventurer with the same fallback
 * policy as {@link streamProse}.
 */
export async function* streamRoomEntry(input: RoomEntryStreamInput): AsyncGenerator<StreamChunk> {
	const { system, room, runSummary, character, inventory } = input;
	const diagnostics = input.diagnostics;
	const endpoint = pickEndpoint(input.endpoints, 'prose');
	if (!endpoint) {
		const fallback = fallbackRoomEntry(room, runSummary);
		logLlmFallback({
			purpose: 'room_prose',
			mode: 'stream',
			reason: 'no_enabled_endpoint',
			configuredTimeoutMs: config.LLM_TIMEOUT_MS,
			configuredMaxTokens: config.LLM_MAX_TOKENS,
			configuredResponseByteLimit: config.LLM_MAX_RESPONSE_BYTES,
			visibleChars: fallback.length,
			...contextFields(diagnostics)
		});
		notifyFallbackDiagnostic(input.onFallbackDiagnostic);
		yield* chunkFallback(fallback);
		return;
	}
	const prompt = composeRoomEntry({
		system,
		room,
		runSummary,
		character,
		inventory
	});
	const configuredTimeoutMs = endpoint.timeoutMs ?? config.LLM_TIMEOUT_MS;
	let visibleChars = 0;
	let stats: LlmStreamStats = { bytes: 0, sseEvents: 0, parseFailures: 0, contentDeltas: 0 };
	try {
		for await (const chunk of callChatStream(
			endpoint,
			[
				{ role: 'system', content: prompt.system },
				{ role: 'user', content: prompt.user }
			],
			{
				signal: input.signal,
				onStats: (s) => {
					stats = s;
				}
			}
		)) {
			if (chunk.done) return;
			if (chunk.content) {
				visibleChars += chunk.content.length;
				yield chunk;
			}
		}
	} catch (error) {
		const failure = toLlmFailure(error);
		if (failure.reason === 'client_disconnect' || failure.reason === 'lease_lost') throw failure;
		const fallback = fallbackRoomEntry(room, runSummary);
		logLlmFallback({
			purpose: 'room_prose',
			mode: 'stream',
			reason: failure.reason,
			endpointId: endpoint.id,
			configuredTimeoutMs,
			configuredMaxTokens: config.LLM_MAX_TOKENS,
			configuredResponseByteLimit: config.LLM_MAX_RESPONSE_BYTES,
			...(failure.status !== undefined ? { status: failure.status } : {}),
			bytes: stats.bytes,
			sseEvents: stats.sseEvents,
			parseFailures: stats.parseFailures,
			contentDeltas: stats.contentDeltas,
			visibleChars: visibleChars > 0 ? visibleChars : fallback.length,
			...contextFields(diagnostics)
		});
		failure.diagnosticLogged = true;
		if (visibleChars > 0) throw failure;
		notifyFallbackDiagnostic(input.onFallbackDiagnostic);
		yield* chunkFallback(fallback);
		return;
	}
	if (visibleChars === 0) {
		const fallback = fallbackRoomEntry(room, runSummary);
		logLlmFallback({
			purpose: 'room_prose',
			mode: 'stream',
			reason: stats.parseFailures > 0 ? 'stream_parse_error' : 'no_content_delta',
			endpointId: endpoint.id,
			configuredTimeoutMs,
			configuredMaxTokens: config.LLM_MAX_TOKENS,
			configuredResponseByteLimit: config.LLM_MAX_RESPONSE_BYTES,
			bytes: stats.bytes,
			sseEvents: stats.sseEvents,
			parseFailures: stats.parseFailures,
			contentDeltas: stats.contentDeltas,
			visibleChars: fallback.length,
			...contextFields(diagnostics)
		});
		notifyFallbackDiagnostic(input.onFallbackDiagnostic);
		yield* chunkFallback(fallback);
		return;
	}
}

export interface InterpretationInput {
	system: string;
	room: RoomSnapshot;
	actionText: string;
	endpoints: readonly EndpointSource[];
	/** Optional call-site context copied into fallback diagnostics. */
	diagnostics?: LlmDiagnosticContext;
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
		JSON.stringify(fallback),
		{},
		input.diagnostics
	);
	try {
		return normalizeActionIntent(room, parseInterpretation(content));
	} catch {
		logLlmFallback({
			purpose: 'interpretation',
			mode: 'non_stream',
			reason: 'invalid_structured_response',
			configuredMaxTokens: config.LLM_MAX_TOKENS,
			configuredResponseByteLimit: config.LLM_MAX_RESPONSE_BYTES,
			visibleChars: content.length,
			...contextFields(input.diagnostics)
		});
		return fallback;
	}
}

export interface SummaryInput {
	system: string;
	room: RoomSnapshot;
	actionText: string;
	outcome: TurnOutcome;
	endpoints: readonly EndpointSource[];
	/** Optional call-site context copied into fallback diagnostics. */
	diagnostics?: LlmDiagnosticContext;
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
		fallbackSummary(room, actionText, outcome),
		{},
		input.diagnostics
	);
}

export interface SuggestionsInput {
	system: string;
	room: RoomSnapshot;
	endpoints: readonly EndpointSource[];
	/** Optional call-site context copied into fallback diagnostics. */
	diagnostics?: LlmDiagnosticContext;
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
		JSON.stringify(fallback),
		{},
		input.diagnostics
	);
	try {
		return parseSuggestions(content);
	} catch {
		logLlmFallback({
			purpose: 'suggestions',
			mode: 'non_stream',
			reason: 'invalid_structured_response',
			configuredMaxTokens: config.LLM_MAX_TOKENS,
			configuredResponseByteLimit: config.LLM_MAX_RESPONSE_BYTES,
			visibleChars: content.length,
			...contextFields(input.diagnostics)
		});
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
