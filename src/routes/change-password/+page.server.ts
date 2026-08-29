import { compare, hash } from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import { SESSION_COOKIE, SESSION_TTL_SECONDS, sessionCookieOptions } from '$lib/server/auth';
import { randomUrlToken, sha256Hex } from '$lib/server/crypto';
import { assertSameOrigin } from '$lib/server/csrf';
import { db } from '$lib/server/db';
import { sessions, users } from '$lib/server/schema';
import type { Actions, PageServerLoad } from './$types';

const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_BYTES = 12;
const MAX_PASSWORD_BYTES = 72;

function passwordError(password: string): string | null {
	const bytes = Buffer.byteLength(password, 'utf8');
	if (bytes < MIN_PASSWORD_BYTES || bytes > MAX_PASSWORD_BYTES) {
		return `Password must be ${MIN_PASSWORD_BYTES} to ${MAX_PASSWORD_BYTES} UTF-8 bytes.`;
	}
	return null;
}

export const load: PageServerLoad = async () => ({});

export const actions: Actions = {
	default: async (event) => {
		assertSameOrigin(event);
		const actor = event.locals.user;
		if (!actor || !event.locals.session) return fail(401, { error: 'Sign in again to continue.' });

		const form = await event.request.formData();
		const currentPassword = String(form.get('currentPassword') ?? '');
		const newPassword = String(form.get('newPassword') ?? '');
		const confirmPassword = String(form.get('confirmPassword') ?? '');
		const invalidPassword = passwordError(newPassword);
		if (invalidPassword) return fail(400, { error: invalidPassword });
		if (newPassword !== confirmPassword) return fail(400, { error: 'New passwords do not match.' });

		const [user] = await db.select().from(users).where(eq(users.id, actor.id)).limit(1);
		if (!user || !(await compare(currentPassword, user.passwordHash))) {
			return fail(400, { error: 'Current password is incorrect.' });
		}

		const passwordHash = await hash(newPassword, BCRYPT_ROUNDS);
		const token = randomUrlToken(32);
		await db.transaction(async (tx) => {
			await tx
				.update(users)
				.set({ passwordHash, mustChangePassword: false, updatedAt: new Date() })
				.where(eq(users.id, actor.id));
			await tx.delete(sessions).where(eq(sessions.userId, actor.id));
			await tx.insert(sessions).values({
				userId: actor.id,
				tokenHash: sha256Hex(token),
				expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000)
			});
		});

		event.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
		return { success: 'Password changed. Other sessions have been signed out.' };
	}
};
