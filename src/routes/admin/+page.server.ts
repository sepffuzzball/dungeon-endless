import { fail } from '@sveltejs/kit';
import { hash } from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireRole } from '$lib/server/authorization';
import { config } from '$lib/server/config';
import { encryptEndpointKey } from '$lib/server/crypto';
import { assertSameOrigin } from '$lib/server/csrf';
import { db } from '$lib/server/db';
import { llmEndpoints, sessions, users } from '$lib/server/schema';
import { normalizeUsername, validateLlmUrl } from '$lib/server/validation';
import type { RequestEvent } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_BYTES = 12;
const MAX_PASSWORD_BYTES = 72;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;
const idSchema = z.string().uuid();
const roleSchema = z.enum(['user', 'editor', 'admin']);
const purposeSchema = z.enum(['prose', 'interpretation', 'summary', 'suggestions']);

function authorize(event: RequestEvent) {
	return requireRole(event, 'admin');
}

function authorizeAction(event: RequestEvent) {
	assertSameOrigin(event);
	return authorize(event);
}

function passwordError(password: string): string | null {
	const bytes = Buffer.byteLength(password, 'utf8');
	if (bytes < MIN_PASSWORD_BYTES || bytes > MAX_PASSWORD_BYTES) {
		return `Password must be ${MIN_PASSWORD_BYTES} to ${MAX_PASSWORD_BYTES} UTF-8 bytes.`;
	}
	return null;
}

function isUniqueViolation(error: unknown): boolean {
	return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

function databaseFailure(): ReturnType<typeof fail> {
	return fail(500, { error: 'The archive could not be updated. Please try again.' });
}

export const load: PageServerLoad = async (event) => {
	authorize(event);
	const [userRows, endpointRows] = await Promise.all([
		db
			.select({
				id: users.id,
				username: users.username,
				role: users.role,
				disabled: users.disabled,
				mustChangePassword: users.mustChangePassword,
				createdAt: users.createdAt
			})
			.from(users)
			.orderBy(users.username),
		db
			.select({
				id: llmEndpoints.id,
				name: llmEndpoints.name,
				purpose: llmEndpoints.purpose,
				baseUrl: llmEndpoints.baseUrl,
				model: llmEndpoints.model,
				enabled: llmEndpoints.enabled,
				timeoutMs: llmEndpoints.timeoutMs
			})
			.from(llmEndpoints)
			.orderBy(llmEndpoints.name)
	]);
	return {
		users: userRows.map((user) => ({
			...user,
			status: user.disabled ? ('disabled' as const) : ('active' as const),
			createdAt: user.createdAt.toISOString()
		})),
		endpoints: endpointRows,
		defaultTimeoutMs: Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, config.LLM_TIMEOUT_MS))
	};
};

export const actions: Actions = {
	user: async (event) => {
		authorizeAction(event);
		const form = await event.request.formData();
		const username = normalizeUsername(String(form.get('username') ?? ''));
		const password = String(form.get('password') ?? '');
		const role = roleSchema.safeParse(form.get('role'));
		if (!username || username.length > 64 || !role.success) {
			return fail(400, { error: 'Enter a valid username and role.' });
		}
		const invalidPassword = passwordError(password);
		if (invalidPassword) return fail(400, { error: invalidPassword });
		try {
			const passwordHash = await hash(password, BCRYPT_ROUNDS);
			await db.insert(users).values({
				username,
				passwordHash,
				role: role.data,
				mustChangePassword: form.get('mustChangePassword') === 'on'
			});
			return { success: 'Account created.' };
		} catch (error) {
			if (isUniqueViolation(error)) {
				return fail(409, { error: 'That username is already in use.' });
			}
			return databaseFailure();
		}
	},
	'toggle-user': async (event) => {
		const actor = authorizeAction(event);
		const form = await event.request.formData();
		const id = idSchema.safeParse(form.get('id'));
		if (!id.success) return fail(400, { error: 'Invalid account selection.' });
		try {
			const [target] = await db
				.select({ disabled: users.disabled })
				.from(users)
				.where(eq(users.id, id.data))
				.limit(1);
			if (!target) return fail(404, { error: 'Account not found.' });
			if (actor.id === id.data && !target.disabled) {
				return fail(400, { error: 'You cannot disable your own account.' });
			}
			await db.transaction(async (tx) => {
				await tx
					.update(users)
					.set({ disabled: !target.disabled, updatedAt: new Date() })
					.where(eq(users.id, id.data));
				if (!target.disabled) await tx.delete(sessions).where(eq(sessions.userId, id.data));
			});
			return { success: `Account ${target.disabled ? 'enabled' : 'disabled'}.` };
		} catch {
			return databaseFailure();
		}
	},
	'reset-password': async (event) => {
		authorizeAction(event);
		const form = await event.request.formData();
		const id = idSchema.safeParse(form.get('id'));
		const password = String(form.get('password') ?? '');
		if (!id.success) return fail(400, { error: 'Invalid account selection.' });
		const invalidPassword = passwordError(password);
		if (invalidPassword) return fail(400, { error: invalidPassword });
		try {
			const passwordHash = await hash(password, BCRYPT_ROUNDS);
			const updated = await db.transaction(async (tx) => {
				const rows = await tx
					.update(users)
					.set({ passwordHash, mustChangePassword: true, updatedAt: new Date() })
					.where(eq(users.id, id.data))
					.returning({ id: users.id });
				if (rows.length) await tx.delete(sessions).where(eq(sessions.userId, id.data));
				return rows.length;
			});
			if (!updated) return fail(404, { error: 'Account not found.' });
			return { success: 'Password reset and all account sessions revoked.' };
		} catch {
			return databaseFailure();
		}
	},
	endpoint: async (event) => {
		authorizeAction(event);
		const form = await event.request.formData();
		const name = String(form.get('name') ?? '').trim();
		const model = String(form.get('model') ?? '').trim();
		const purpose = purposeSchema.safeParse(form.get('purpose'));
		const timeoutMs = Number(form.get('timeoutMs'));
		const apiKey = String(form.get('apiKey') ?? '').trim();
		if (!name || name.length > 120 || !model || model.length > 200 || !purpose.success) {
			return fail(400, { error: 'Enter a valid endpoint name, purpose, and model.' });
		}
		if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
			return fail(400, { error: `Timeout must be ${MIN_TIMEOUT_MS} to ${MAX_TIMEOUT_MS} ms.` });
		}
		let baseUrl: string;
		try {
			baseUrl = validateLlmUrl(String(form.get('baseUrl') ?? '')).toString();
		} catch (error) {
			return fail(400, {
				error: error instanceof Error ? error.message : 'Endpoint URL is not permitted.'
			});
		}
		try {
			await db.insert(llmEndpoints).values({
				name,
				purpose: purpose.data,
				baseUrl,
				model,
				timeoutMs,
				enabled: form.get('enabled') === 'on',
				apiKeyEnc: apiKey ? encryptEndpointKey(apiKey) : null
			});
			return { success: 'Endpoint stored.' };
		} catch (error) {
			if (isUniqueViolation(error)) {
				return fail(409, { error: 'An endpoint with those details already exists.' });
			}
			return databaseFailure();
		}
	},
	'toggle-endpoint': async (event) => {
		authorizeAction(event);
		const form = await event.request.formData();
		const id = idSchema.safeParse(form.get('id'));
		if (!id.success) return fail(400, { error: 'Invalid endpoint selection.' });
		try {
			const [target] = await db
				.select({ enabled: llmEndpoints.enabled })
				.from(llmEndpoints)
				.where(eq(llmEndpoints.id, id.data))
				.limit(1);
			if (!target) return fail(404, { error: 'Endpoint not found.' });
			await db
				.update(llmEndpoints)
				.set({ enabled: !target.enabled, updatedAt: new Date() })
				.where(eq(llmEndpoints.id, id.data));
			return { success: `Endpoint ${target.enabled ? 'disabled' : 'enabled'}.` };
		} catch {
			return databaseFailure();
		}
	}
};
