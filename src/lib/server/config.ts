import { z } from 'zod';

function boolFromEnv(value: string | undefined, fallback: boolean): boolean {
	if (value === undefined) return fallback;
	return value === 'true' || value === '1';
}

/**
 * Parse a strict decimal integer from an environment variable. Returns the
 * fallback when the variable is undefined; returns NaN for any other input so
 * that zod rejects the value and startup reports the offending config key
 * instead of silently truncating. Formatted values such as `1_048_576`,
 * `1,048,576`, or `1MB` are rejected; only plain digits are accepted.
 */
export function intFromEnv(value: string | undefined, fallback: number): number {
	if (value === undefined) return fallback;
	const trimmed = value.trim();
	if (!/^\d+$/.test(trimmed)) return Number.NaN;
	const parsed = Number(trimmed);
	return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

const configSchema = z.object({
	DATABASE_URL: z.string().min(1),
	APP_ENCRYPTION_KEY: z.string().min(1),
	NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
	PORT: z.number().int().positive().default(3000),
	SECURE_COOKIE: z.boolean().default(false),
	ALLOW_INSECURE_LLM_URLS: z.boolean().default(false),
	ALLOW_PRIVATE_LLM_URLS: z.boolean().default(false),
	LLM_MAX_TOKENS: z.number().int().positive().default(600),
	LLM_TIMEOUT_MS: z.number().int().positive().default(20000),
	LLM_MAX_RESPONSE_BYTES: z.number().int().positive().default(8192),
	LLM_DIAGNOSTICS: z.boolean().default(true),
	BOOTSTRAP_ADMIN_USERNAME: z.string().optional(),
	BOOTSTRAP_ADMIN_PASSWORD: z.string().optional()
});

export type Config = z.infer<typeof configSchema>;

function loadConfig(): Config {
	const result = configSchema.safeParse({
		DATABASE_URL: process.env.DATABASE_URL,
		APP_ENCRYPTION_KEY: process.env.APP_ENCRYPTION_KEY,
		NODE_ENV: process.env.NODE_ENV,
		PORT: intFromEnv(process.env.PORT, 3000),
		SECURE_COOKIE: boolFromEnv(process.env.SECURE_COOKIE, false),
		ALLOW_INSECURE_LLM_URLS: boolFromEnv(process.env.ALLOW_INSECURE_LLM_URLS, false),
		ALLOW_PRIVATE_LLM_URLS: boolFromEnv(process.env.ALLOW_PRIVATE_LLM_URLS, false),
		LLM_MAX_TOKENS: intFromEnv(process.env.LLM_MAX_TOKENS, 600),
		LLM_TIMEOUT_MS: intFromEnv(process.env.LLM_TIMEOUT_MS, 20000),
		LLM_MAX_RESPONSE_BYTES: intFromEnv(process.env.LLM_MAX_RESPONSE_BYTES, 8192),
		LLM_DIAGNOSTICS: boolFromEnv(process.env.LLM_DIAGNOSTICS, true),
		BOOTSTRAP_ADMIN_USERNAME: process.env.BOOTSTRAP_ADMIN_USERNAME,
		BOOTSTRAP_ADMIN_PASSWORD: process.env.BOOTSTRAP_ADMIN_PASSWORD
	});
	if (!result.success) {
		// Report the offending key without echoing any secret values.
		const paths = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
		throw new Error(`Invalid environment configuration for: ${paths}`);
	}
	return result.data;
}

export const config = loadConfig();

export const isProduction = config.NODE_ENV === 'production';

export const secureCookies = config.SECURE_COOKIE || isProduction;
