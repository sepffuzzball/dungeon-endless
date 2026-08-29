import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { compare } from 'bcryptjs';
import { eq } from 'drizzle-orm';
import {
	createSession,
	revokeExpiredSessions,
	SESSION_COOKIE,
	sessionCookieOptions
} from '$lib/server/auth';
import { db } from '$lib/server/db';
import { users } from '$lib/server/schema';
import { loginSchema, normalizeUsername } from '$lib/server/validation';

export const load: PageServerLoad = async () => ({});

export const actions: Actions = {
	default: async (event) => {
		const form = await event.request.formData();
		const parsed = loginSchema.safeParse({
			username: String(form.get('username') ?? ''),
			password: String(form.get('password') ?? '')
		});
		if (!parsed.success) {
			return fail(400, { error: 'Invalid username or password.' });
		}

		const username = normalizeUsername(parsed.data.username);
		const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);
		if (!user) {
			return fail(401, { error: 'Invalid username or password.' });
		}

		const valid = await compare(parsed.data.password, user.passwordHash);
		if (!valid) {
			return fail(401, { error: 'Invalid username or password.' });
		}
		if (user.disabled) {
			return fail(403, { error: 'This account is disabled.' });
		}

		await revokeExpiredSessions(user.id);
		const token = await createSession(user.id);
		event.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);

		throw redirect(303, '/');
	}
};
