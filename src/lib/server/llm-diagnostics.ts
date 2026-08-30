import { randomUUID } from 'node:crypto';
import { config } from './config';

/*
 * Safe one-line fallback diagnostics for the LLM layer. Emits a single
 * structured console.warn line each time a streaming or non-streaming helper
 * selects its deterministic fallback. Only bounded, non-secret fields are
 * ever serialized: never URLs, models, keys, prompts, bodies, stacks or raw
 * error messages. Logging itself never throws.
 */

export const LLM_FALLBACK_EVENT_NAME = 'llm_fallback' as const;
export const LLM_FALLBACK_LOG_PREFIX = '[dungeon-llm-fallback]';
export const LLM_ROUTE_ERROR_EVENT_NAME = 'llm_route_error' as const;
export const LLM_ROUTE_ERROR_LOG_PREFIX = '[dungeon-llm-route-error]';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeUuid(value: string | undefined): string | undefined {
	return value !== undefined && UUID_PATTERN.test(value) ? value : undefined;
}

export const LLM_FALLBACK_REASONS = [
	'no_enabled_endpoint',
	'timeout',
	'http_status',
	'redirect_rejected',
	'missing_body',
	'response_too_large',
	'decoder_limit',
	'url_or_dns_validation',
	'key_decryption',
	'network_error',
	'stream_parse_error',
	'no_content_delta',
	'invalid_structured_response',
	'room_state_mismatch',
	'lease_lost',
	'database_or_route_error',
	'client_disconnect',
	'non_enhanced_request',
	'recovery_fallback',
	'unknown'
] as const;

export type LlmFallbackReason = (typeof LLM_FALLBACK_REASONS)[number];
const LLM_FALLBACK_REASON_SET = new Set<string>(LLM_FALLBACK_REASONS);

function safeReason(value: unknown): LlmFallbackReason {
	return typeof value === 'string' && LLM_FALLBACK_REASON_SET.has(value)
		? (value as LlmFallbackReason)
		: 'unknown';
}

export type LlmFallbackPurpose =
	'prose' | 'room_prose' | 'summary' | 'interpretation' | 'suggestions';

export type LlmFallbackMode = 'stream' | 'non_stream' | 'route' | 'non_enhanced';

/** Everything a call site may supply; every value is safe and bounded. */
export interface LlmFallbackInput {
	correlationId?: string;
	purpose: LlmFallbackPurpose;
	mode: LlmFallbackMode;
	reason: LlmFallbackReason;
	endpointId?: string;
	configuredTimeoutMs?: number;
	status?: number;
	bytes?: number;
	sseEvents?: number;
	parseFailures?: number;
	contentDeltas?: number;
	visibleChars?: number;
	runId?: string;
	targetId?: string;
	narrationKind?: 'turn' | 'room';
}

/** The exact shape serialized to the log. */
export interface LlmFallbackEvent {
	event: typeof LLM_FALLBACK_EVENT_NAME;
	timestamp: string;
	correlationId: string;
	purpose: LlmFallbackPurpose;
	mode: LlmFallbackMode;
	reason: LlmFallbackReason;
	endpointId?: string;
	configuredTimeoutMs?: number;
	status?: number;
	bytes?: number;
	sseEvents?: number;
	parseFailures?: number;
	contentDeltas?: number;
	visibleChars?: number;
	runId?: string;
	targetId?: string;
	narrationKind?: 'turn' | 'room';
}

/** Optional call-site context propagated into fallback events. */
export interface LlmDiagnosticContext {
	correlationId?: string;
	runId?: string;
	targetId?: string;
	narrationKind?: 'turn' | 'room';
}

/** Safe route-level failure fields. Route errors never imply fallback persistence. */
export interface LlmRouteErrorInput extends LlmDiagnosticContext {
	purpose: 'prose' | 'room_prose';
	reason: LlmFallbackReason;
}

export interface LlmRouteErrorEvent extends LlmRouteErrorInput {
	event: typeof LLM_ROUTE_ERROR_EVENT_NAME;
	timestamp: string;
	correlationId: string;
}

/** Builds the shared context fields from an optional diagnostic context. */
export function contextFields(diagnostics?: LlmDiagnosticContext): Partial<LlmFallbackInput> {
	if (!diagnostics) return {};
	return {
		...(safeUuid(diagnostics.correlationId)
			? { correlationId: safeUuid(diagnostics.correlationId) }
			: {}),
		...(safeUuid(diagnostics.runId) ? { runId: safeUuid(diagnostics.runId) } : {}),
		...(safeUuid(diagnostics.targetId) ? { targetId: safeUuid(diagnostics.targetId) } : {}),
		...(diagnostics.narrationKind ? { narrationKind: diagnostics.narrationKind } : {})
	};
}

/**
 * Writes one safe one-line warning when an LLM helper selects its fallback.
 * Respects `config.LLM_DIAGNOSTICS` and never throws.
 */
export function logLlmFallback(input: LlmFallbackInput): void {
	if (!config.LLM_DIAGNOSTICS) return;
	try {
		const correlationId = safeUuid(input.correlationId) ?? randomUUID();
		const endpointId = safeUuid(input.endpointId);
		const runId = safeUuid(input.runId);
		const targetId = safeUuid(input.targetId);
		const event: LlmFallbackEvent = {
			event: LLM_FALLBACK_EVENT_NAME,
			timestamp: new Date().toISOString(),
			correlationId,
			purpose: input.purpose,
			mode: input.mode,
			reason: safeReason(input.reason),
			...(endpointId !== undefined ? { endpointId } : {}),
			...(input.configuredTimeoutMs !== undefined
				? { configuredTimeoutMs: input.configuredTimeoutMs }
				: {}),
			...(input.status !== undefined ? { status: input.status } : {}),
			...(input.bytes !== undefined ? { bytes: input.bytes } : {}),
			...(input.sseEvents !== undefined ? { sseEvents: input.sseEvents } : {}),
			...(input.parseFailures !== undefined ? { parseFailures: input.parseFailures } : {}),
			...(input.contentDeltas !== undefined ? { contentDeltas: input.contentDeltas } : {}),
			...(input.visibleChars !== undefined ? { visibleChars: input.visibleChars } : {}),
			...(runId !== undefined ? { runId } : {}),
			...(targetId !== undefined ? { targetId } : {}),
			...(input.narrationKind !== undefined ? { narrationKind: input.narrationKind } : {})
		};
		console.warn(`${LLM_FALLBACK_LOG_PREFIX} ${JSON.stringify(event)}`);
	} catch {
		// Diagnostics must never interrupt gameplay or request handling.
	}
}

/** Writes a safe one-line warning for a route failure that did not save a fallback. */
export function logLlmRouteError(input: LlmRouteErrorInput): void {
	if (!config.LLM_DIAGNOSTICS) return;
	try {
		const context = contextFields(input);
		const event: LlmRouteErrorEvent = {
			event: LLM_ROUTE_ERROR_EVENT_NAME,
			timestamp: new Date().toISOString(),
			correlationId: context.correlationId ?? randomUUID(),
			purpose: input.purpose,
			reason: safeReason(input.reason),
			...(context.runId !== undefined ? { runId: context.runId } : {}),
			...(context.targetId !== undefined ? { targetId: context.targetId } : {}),
			...(context.narrationKind !== undefined ? { narrationKind: context.narrationKind } : {})
		};
		console.warn(`${LLM_ROUTE_ERROR_LOG_PREFIX} ${JSON.stringify(event)}`);
	} catch {
		// Diagnostics must never interrupt gameplay or request handling.
	}
}

/** Typed internal failure with a bounded reason (and optional HTTP status). */
export class LlmFailure extends Error {
	readonly reason: LlmFallbackReason;
	readonly status?: number;
	diagnosticLogged: boolean;
	constructor(
		reason: LlmFallbackReason,
		message: string,
		options?: { status?: number; diagnosticLogged?: boolean }
	) {
		super(message);
		this.name = 'LlmFailure';
		this.reason = reason;
		this.diagnosticLogged = options?.diagnosticLogged ?? false;
		if (options?.status !== undefined) this.status = options.status;
	}
}

/** Returns a bounded internal failure without retaining arbitrary thrown content. */
export function toLlmFailure(error: unknown, fallback: LlmFallbackReason = 'unknown'): LlmFailure {
	if (error instanceof LlmFailure) return error;
	return new LlmFailure(classifyLlmFailure(error, fallback), 'LLM request failed');
}

function isAbortError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	if (error.name === 'AbortError') return true;
	return (
		typeof DOMException !== 'undefined' &&
		error instanceof DOMException &&
		error.name === 'AbortError'
	);
}

/**
 * Maps an unknown thrown value to the bounded reason union. Typed internal
 * failures keep their reason, aborts map to timeout, recognizable plain
 * errors map conservatively, and anything else defaults to `fallback`
 * (usually `unknown`). Error messages are inspected but never logged.
 */
export function classifyLlmFailure(
	error: unknown,
	fallback: LlmFallbackReason = 'unknown'
): LlmFallbackReason {
	if (error instanceof LlmFailure) return error.reason;
	if (isAbortError(error)) return 'timeout';
	if (error instanceof Error) {
		const message = error.message.toLowerCase();
		if (/timed out|timeout/.test(message)) return 'timeout';
		if (
			/valid url|http or https|must not contain credentials|disallow|private|loopback|link-local|could not be resolved|resolves to/.test(
				message
			)
		) {
			return 'url_or_dns_validation';
		}
		if (/invalid encrypted payload|decrypt|decryption/.test(message)) {
			return 'key_decryption';
		}
		if (
			/fetch failed|network|econnrefused|econnreset|enotfound|socket|temporary failure/.test(
				message
			)
		) {
			return 'network_error';
		}
	}
	return fallback;
}

/** Cumulative metrics reported by a streaming call for fallback diagnostics. */
export interface LlmStreamStats {
	bytes: number;
	sseEvents: number;
	parseFailures: number;
	contentDeltas: number;
}
