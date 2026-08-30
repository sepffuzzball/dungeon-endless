import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
	process.env.DATABASE_URL = 'postgres://test:test@localhost/test';
	process.env.APP_ENCRYPTION_KEY =
		'0000000000000000000000000000000000000000000000000000000000000000';
	process.env.NODE_ENV = 'test';
	process.env.LLM_DIAGNOSTICS = 'true';
});

import { config } from '../src/lib/server/config';
import {
	classifyLlmFailure,
	LlmFailure,
	LLM_FALLBACK_LOG_PREFIX,
	LLM_ROUTE_ERROR_LOG_PREFIX,
	logLlmFallback,
	logLlmRouteError
} from '../src/lib/server/llm-diagnostics';

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const minimal = {
	purpose: 'prose',
	mode: 'stream',
	reason: 'no_enabled_endpoint'
} as const;

describe('logLlmFallback', () => {
	it('writes one one-line warn with the structured prefix when enabled', () => {
		logLlmFallback(minimal);
		expect(warn).toHaveBeenCalledTimes(1);
		const line = warn.mock.calls[0][0] as string;
		expect(line.startsWith(`${LLM_FALLBACK_LOG_PREFIX} `)).toBe(true);
		expect(line).not.toContain('\n');
		const payload = parseLog(line);
		expect(payload.event).toBe('llm_fallback');
		expect(payload.reason).toBe('no_enabled_endpoint');
		expect(payload.purpose).toBe('prose');
		expect(payload.mode).toBe('stream');
		expect(payload.correlationId).toMatch(UUID_RE);
		expect(Number.isNaN(Date.parse(payload.timestamp as string))).toBe(false);
	});

	it('emits nothing when the flag is disabled', () => {
		config.LLM_DIAGNOSTICS = false;
		logLlmFallback({ ...minimal, reason: 'timeout' });
		expect(warn).not.toHaveBeenCalled();
	});

	it('propagates provided correlation and call-site context', () => {
		logLlmFallback({
			correlationId: '00000000-0000-4000-8000-000000000000',
			purpose: 'prose',
			mode: 'stream',
			reason: 'no_content_delta',
			runId: '11111111-1111-4111-8111-111111111111',
			targetId: '22222222-2222-4222-8222-222222222222',
			narrationKind: 'turn'
		});
		const payload = parseLog(warn.mock.calls[0][0]);
		expect(payload.correlationId).toBe('00000000-0000-4000-8000-000000000000');
		expect(payload.runId).toBe('11111111-1111-4111-8111-111111111111');
		expect(payload.targetId).toBe('22222222-2222-4222-8222-222222222222');
		expect(payload.narrationKind).toBe('turn');
	});

	it('never serializes URL, model, key, content, stack or raw message fields', () => {
		const secret = 'sk-do-not-log-this';
		const prompt = 'the player opens the hidden obsidian door';
		const rawError = 'fetch failed against secret.internal with Bearer abc123';
		logLlmFallback({
			...minimal,
			reason: 'http_status',
			endpointName: 'primary-secret-endpoint',
			endpointId: 'not-a-uuid-secret',
			status: 503,
			bytes: 120,
			parseFailures: 3,
			url: 'https://secret.internal/v1',
			model: 'private-model',
			apiKey: secret,
			prompt,
			responseBody: prompt,
			message: rawError,
			stack: rawError
		} as Parameters<typeof logLlmFallback>[0]);
		expect(classifyLlmFailure(new Error(rawError))).toBe('network_error');
		expect(warn).toHaveBeenCalledTimes(1);
		const line = warn.mock.calls[0][0] as string;
		const payload = parseLog(warn.mock.calls[0][0]);
		expect(payload).not.toHaveProperty('url');
		expect(payload).not.toHaveProperty('baseUrl');
		expect(payload).not.toHaveProperty('model');
		expect(payload).not.toHaveProperty('key');
		expect(payload).not.toHaveProperty('apiKey');
		expect(payload).not.toHaveProperty('content');
		expect(payload).not.toHaveProperty('body');
		expect(payload).not.toHaveProperty('stack');
		expect(payload).not.toHaveProperty('message');
		expect(payload).not.toHaveProperty('name');
		expect(payload).not.toHaveProperty('endpointName');
		expect(payload).not.toHaveProperty('endpointId');
		expect(payload).toHaveProperty('status', 503);
		expect(line).not.toContain(secret);
		expect(line).not.toContain(prompt);
		expect(line).not.toContain(rawError);
		expect(line).not.toContain('secret.internal');
		expect(line).not.toContain('primary-secret-endpoint');
		expect(line).not.toContain('not-a-uuid-secret');
	});

	it('never throws even when console.warn itself throws', () => {
		warn.mockImplementation(() => {
			throw new Error('console broken');
		});
		expect(() => logLlmFallback({ ...minimal, reason: 'network_error' })).not.toThrow();
	});
});

describe('logLlmRouteError', () => {
	it('writes a distinct safe one-line route error without raw fields', () => {
		const raw = 'secret database failure at private.internal';
		logLlmRouteError({
			purpose: 'room_prose',
			reason: 'database_or_route_error',
			correlationId: '00000000-0000-4000-8000-000000000000',
			runId: 'not-a-safe-id',
			targetId: '22222222-2222-4222-8222-222222222222',
			narrationKind: 'room',
			message: raw,
			content: raw
		} as Parameters<typeof logLlmRouteError>[0]);

		expect(warn).toHaveBeenCalledTimes(1);
		const line = warn.mock.calls[0][0] as string;
		expect(line.startsWith(`${LLM_ROUTE_ERROR_LOG_PREFIX} `)).toBe(true);
		expect(line).not.toContain('\n');
		expect(line).not.toContain(raw);
		const payload = JSON.parse(line.slice(LLM_ROUTE_ERROR_LOG_PREFIX.length + 1));
		expect(payload).toMatchObject({
			event: 'llm_route_error',
			purpose: 'room_prose',
			reason: 'database_or_route_error',
			correlationId: '00000000-0000-4000-8000-000000000000',
			targetId: '22222222-2222-4222-8222-222222222222',
			narrationKind: 'room'
		});
		expect(payload).not.toHaveProperty('runId');
		expect(payload).not.toHaveProperty('message');
		expect(payload).not.toHaveProperty('content');
	});

	it('replaces a non-allowlisted reason rather than serializing it', () => {
		logLlmRouteError({
			purpose: 'prose',
			reason: 'raw secret reason' as 'unknown'
		});
		const line = warn.mock.calls[0][0] as string;
		const payload = JSON.parse(line.slice(LLM_ROUTE_ERROR_LOG_PREFIX.length + 1));
		expect(payload.reason).toBe('unknown');
		expect(line).not.toContain('raw secret reason');
	});
});

describe('classifyLlmFailure', () => {
	it('preserves the typed reason of internal failures', () => {
		expect(classifyLlmFailure(new LlmFailure('http_status', 'bad status'))).toBe('http_status');
		expect(classifyLlmFailure(new LlmFailure('decoder_limit', 'buffer'))).toBe('decoder_limit');
		expect(classifyLlmFailure(new LlmFailure('response_too_large', 'big'))).toBe(
			'response_too_large'
		);
	});

	it('maps abort errors to timeout', () => {
		const abort = new DOMException('aborted', 'AbortError');
		expect(classifyLlmFailure(abort)).toBe('timeout');
	});

	it('maps recognizable network and validation errors conservatively', () => {
		expect(classifyLlmFailure(new Error('request timed out'))).toBe('timeout');
		expect(classifyLlmFailure(new Error('fetch failed'))).toBe('network_error');
		expect(classifyLlmFailure(new Error('ECONNREFUSED connecting'))).toBe('network_error');
		expect(classifyLlmFailure(new Error('Endpoint hostname could not be resolved'))).toBe(
			'url_or_dns_validation'
		);
	});

	it('defaults unclassifiable values to unknown', () => {
		expect(classifyLlmFailure(new Error('completely unrelated'))).toBe('unknown');
		expect(classifyLlmFailure(undefined)).toBe('unknown');
		expect(classifyLlmFailure('a string')).toBe('unknown');
	});
});
