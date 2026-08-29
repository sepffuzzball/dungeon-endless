import { redirect, type Handle } from '@sveltejs/kit';
import { openSession, SESSION_COOKIE, sessionCookieOptions } from '$lib/server/auth';

const PUBLIC_PATHS = new Set(['/login', '/health', '/logout']);
const PASSWORD_CHANGE_PATHS = new Set(['/change-password', '/health', '/logout']);

export const handle: Handle = async ({ event, resolve }) => {
	const pathname = new URL(event.request.url).pathname;

	let resolved: Awaited<ReturnType<typeof openSession>> | null = null;
	try {
		resolved = await openSession(event);
	} catch {
		// Treat DB unavailability as unauthenticated rather than crashing the request.
		resolved = null;
	}

	if (resolved) {
		event.locals.user = resolved.user;
		event.locals.session = resolved.session;
		if (resolved.user.mustChangePassword && !PASSWORD_CHANGE_PATHS.has(pathname)) {
			throw redirect(303, '/change-password');
		}
		if (pathname === '/login') throw redirect(303, '/');
	} else {
		if (event.cookies.get(SESSION_COOKIE)) {
			// Stale, expired or invalid session cookie - clear it.
			event.cookies.delete(SESSION_COOKIE, sessionCookieOptions);
		}
		if (!PUBLIC_PATHS.has(pathname)) {
			throw redirect(303, '/login');
		}
	}

	return resolve(event);
};
