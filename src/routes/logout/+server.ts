import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { revokeSession, SESSION_COOKIE, sessionCookieOptions } from '$lib/server/auth';
import { assertSameOrigin } from '$lib/server/csrf';

export const POST: RequestHandler = async (event) => {
	assertSameOrigin(event);
	if (event.locals.session) {
		await revokeSession(event.locals.session.id);
	}
	event.cookies.delete(SESSION_COOKIE, sessionCookieOptions);
	throw redirect(303, '/login');
};
