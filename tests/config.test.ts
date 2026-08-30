import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Config } from '../src/lib/server/config';

// config.ts runs loadConfig() at module import time, so it must be imported
// dynamically with the environment prepared first. vi.resetModules() forces a
// fresh module evaluation on every load.

const baseEnv: Record<string, string> = {
	DATABASE_URL: 'postgres://user:pass@localhost:5432/dungeon',
	APP_ENCRYPTION_KEY: 'a'.repeat(64),
	NODE_ENV: 'development'
};

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
	savedEnv = { ...process.env };
});

afterEach(() => {
	process.env = savedEnv;
});

async function loadModuleWithEnv(
	env: Record<string, string>
): Promise<typeof import('../src/lib/server/config')> {
	vi.resetModules();
	process.env = { ...savedEnv, ...baseEnv, ...env };
	return import('../src/lib/server/config');
}

async function loadConfigWithEnv(env: Record<string, string>): Promise<Config> {
	const mod = await loadModuleWithEnv(env);
	return mod.config;
}

describe('intFromEnv', () => {
	it('parses exact plain decimal digits', async () => {
		const mod = await loadModuleWithEnv({});
		expect(mod.intFromEnv('1048576', 0)).toBe(1048576);
	});

	it('falls back when the variable is undefined', async () => {
		const mod = await loadModuleWithEnv({});
		expect(mod.intFromEnv(undefined, 8192)).toBe(8192);
	});

	it('accepts surrounding whitespace around plain digits', async () => {
		const mod = await loadModuleWithEnv({});
		expect(mod.intFromEnv('  1048576  ', 0)).toBe(1048576);
		expect(mod.intFromEnv('  600', 0)).toBe(600);
		expect(mod.intFromEnv('600  ', 0)).toBe(600);
	});

	it('accepts the largest safe integer', async () => {
		const mod = await loadModuleWithEnv({});
		expect(mod.intFromEnv('9007199254740991', 0)).toBe(9007199254740991);
	});

	it('rejects separators, units, decimals, and exponent notation', async () => {
		const mod = await loadModuleWithEnv({});
		const badValues = ['1_048_576', '1,048,576', '1MB', '1.5', '1e6', '1e+6', '0x10'];
		for (const bad of badValues) {
			expect(Number.isNaN(mod.intFromEnv(bad, 0)), `${bad} should be rejected`).toBe(true);
		}
	});

	it('rejects junk, empty, and whitespace-only input', async () => {
		const mod = await loadModuleWithEnv({});
		const badValues = ['abc', '', '   ', '-1', '+1', '--1', '1 2', 'Infinity', 'NaN'];
		for (const bad of badValues) {
			expect(Number.isNaN(mod.intFromEnv(bad, 0)), `${bad} should be rejected`).toBe(true);
		}
	});

	it('rejects values that exceed the safe integer range', async () => {
		const mod = await loadModuleWithEnv({});
		const bigValues = ['9007199254740992', '99999999999999999999'];
		for (const big of bigValues) {
			expect(Number.isNaN(mod.intFromEnv(big, 0)), `${big} should be rejected`).toBe(true);
		}
	});
});

describe('loadConfig', () => {
	it('uses the configured integer value when valid', async () => {
		const cfg = await loadConfigWithEnv({
			LLM_MAX_TOKENS: '2400',
			LLM_MAX_RESPONSE_BYTES: '1048576'
		});
		expect(cfg.LLM_MAX_TOKENS).toBe(2400);
		expect(cfg.LLM_MAX_RESPONSE_BYTES).toBe(1048576);
	});

	it('accepts whitespace around plain digits', async () => {
		const cfg = await loadConfigWithEnv({ LLM_MAX_RESPONSE_BYTES: '  1048576  ' });
		expect(cfg.LLM_MAX_RESPONSE_BYTES).toBe(1048576);
	});

	it('falls back to defaults when int vars are unset', async () => {
		const cfg = await loadConfigWithEnv({});
		expect(cfg.PORT).toBe(3000);
		expect(cfg.LLM_MAX_TOKENS).toBe(1600);
		expect(cfg.LLM_TIMEOUT_MS).toBe(20000);
		expect(cfg.LLM_MAX_RESPONSE_BYTES).toBe(262144);
	});

	it('rejects formatted, non-numeric, and zero values and reports the offending key', async () => {
		const badValues = ['1_048_576', '1,048,576', '1MB', '1.5', '1e6', 'junk', '', '0'];
		for (const bad of badValues) {
			await expect(loadConfigWithEnv({ LLM_MAX_RESPONSE_BYTES: bad })).rejects.toThrow(
				/LLM_MAX_RESPONSE_BYTES/
			);
		}
	});

	it('reports each int key when its value is invalid', async () => {
		await expect(loadConfigWithEnv({ LLM_MAX_TOKENS: '600x' })).rejects.toThrow(/LLM_MAX_TOKENS/);
		await expect(loadConfigWithEnv({ LLM_TIMEOUT_MS: '20,000' })).rejects.toThrow(/LLM_TIMEOUT_MS/);
		await expect(loadConfigWithEnv({ PORT: '3000k' })).rejects.toThrow(/PORT/);
	});

	it('rejects values that exceed the safe integer range at startup', async () => {
		await expect(loadConfigWithEnv({ LLM_MAX_RESPONSE_BYTES: '9007199254740992' })).rejects.toThrow(
			/LLM_MAX_RESPONSE_BYTES/
		);
	});
});
