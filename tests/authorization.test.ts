import { describe, it, expect } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import type { SafeUser } from '../src/lib/types';
import { assertOwned, requireRole, requireUser } from '../src/lib/server/authorization';

const user: SafeUser = {
	id: 'u1',
	username: 'alice',
	role: 'admin',
	mustChangePassword: false,
	createdAt: '2026-01-01T00:00:00.000Z'
};

function fakeEvent(current?: SafeUser): RequestEvent {
	return { locals: { user: current } } as unknown as RequestEvent;
}

function isRedirect(err: unknown): err is { status: number; location: string } {
	return (
		typeof err === 'object' &&
		err !== null &&
		'status' in err &&
		'location' in err &&
		typeof (err as { location: unknown }).location === 'string'
	);
}

function isError(err: unknown): err is { status: number } {
	return typeof err === 'object' && err !== null && 'status' in err;
}

describe('requireUser', () => {
	it('returns the authenticated user when present', () => {
		expect(requireUser(fakeEvent(user))).toBe(user);
	});

	it('redirects to login when unauthenticated', () => {
		try {
			requireUser(fakeEvent());
			expect.unreachable('expected a redirect');
		} catch (err) {
			expect(isRedirect(err)).toBe(true);
			if (isRedirect(err)) {
				expect(err.status).toBe(303);
				expect(err.location).toBe('/login');
			}
		}
	});
});

describe('requireRole', () => {
	it('allows a matching single role', () => {
		expect(requireRole(fakeEvent(user), 'admin')).toBe(user);
	});

	it('allows any matching role in a list', () => {
		const editor = { ...user, role: 'editor' as const };
		expect(requireRole(fakeEvent(editor), ['user', 'editor'])).toBe(editor);
	});

	it('redirects home for a mismatched role', () => {
		try {
			requireRole(fakeEvent({ ...user, role: 'user' }), 'editor');
			expect.unreachable('expected a redirect');
		} catch (err) {
			expect(isRedirect(err)).toBe(true);
			if (isRedirect(err)) {
				expect(err.status).toBe(303);
				expect(err.location).toBe('/');
			}
		}
	});
});

describe('assertOwned', () => {
	it('returns the user when they own the resource', () => {
		expect(assertOwned(fakeEvent(user), 'u1')).toBe(user);
	});

	it('throws 403 when the user does not own the resource', () => {
		try {
			assertOwned(fakeEvent(user), 'someone-else');
			expect.unreachable('expected an error');
		} catch (err) {
			expect(isError(err)).toBe(true);
			if (isError(err)) expect(err.status).toBe(403);
		}
	});
});
