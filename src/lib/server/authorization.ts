import { error, redirect } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import type { Role, SafeUser } from '$lib/types';

/** Returns the authenticated user or redirects to the login page. */
export function requireUser(event: RequestEvent): SafeUser {
	const user = event.locals.user;
	if (!user) throw redirect(303, '/login');
	return user;
}

/** Requires an authenticated user with one of the given roles; otherwise redirects home. */
export function requireRole(event: RequestEvent, roles: Role | readonly Role[]): SafeUser {
	const user = requireUser(event);
	const allowed = typeof roles === 'string' ? [roles] : roles;
	if (!allowed.includes(user.role)) throw redirect(303, '/');
	return user;
}

/** Asserts the authenticated user owns the given resource id; otherwise throws 403. */
export function assertOwned(event: RequestEvent, ownerId: string): SafeUser {
	const user = requireUser(event);
	if (user.id !== ownerId) throw error(403, 'Forbidden');
	return user;
}
