import type { CookieSerializeOptions } from 'cookie';
import type { RequestEvent } from '@sveltejs/kit';
import { and, eq, sql } from 'drizzle-orm';
import type { SafeSession, SafeUser } from '$lib/types';
import { db } from './db';
import { sessions, type Session, type User, users } from './schema';
import { randomUrlToken, sha256Hex } from './crypto';
import { secureCookies } from './config';

export const SESSION_COOKIE = 'de_session';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export const sessionCookieOptions = {
	httpOnly: true,
	sameSite: 'lax' as const,
	path: '/',
	secure: secureCookies,
	maxAge: SESSION_TTL_SECONDS
} satisfies CookieSerializeOptions;

function toSafeUser(row: User): SafeUser {
	return {
		id: row.id,
		username: row.username,
		companyName: row.companyName,
		companyGold: row.companyGold,
		brutality: row.brutality,
		debauchery: row.debauchery,
		role: row.role,
		mustChangePassword: row.mustChangePassword,
		createdAt: row.createdAt.toISOString()
	};
}

function toSafeSession(row: Session): SafeSession {
	return {
		id: row.id,
		userId: row.userId,
		expiresAt: row.expiresAt.toISOString()
	};
}

/** Creates a fresh opaque session token (only its SHA-256 is persisted) and returns the raw cookie value. */
export async function createSession(userId: string): Promise<string> {
	const token = randomUrlToken(32);
	await db.insert(sessions).values({
		userId,
		tokenHash: sha256Hex(token),
		expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000)
	});
	return token;
}

/** Resolves the request's session cookie into a user + session, or null when absent/invalid/expired/disabled. */
export async function openSession(
	event: RequestEvent
): Promise<{ user: SafeUser; session: SafeSession } | null> {
	const token = event.cookies.get(SESSION_COOKIE);
	if (!token) return null;

	const [session] = await db
		.select()
		.from(sessions)
		.where(and(eq(sessions.tokenHash, sha256Hex(token)), sql`${sessions.expiresAt} > now()`))
		.limit(1);
	if (!session) return null;

	const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
	if (!user || user.disabled) return null;

	return { user: toSafeUser(user), session: toSafeSession(session) };
}

/** Revokes a specific session by id. */
export async function revokeSession(sessionId: string): Promise<void> {
	await db.delete(sessions).where(eq(sessions.id, sessionId));
}

/** Removes expired sessions for a user so only fresh ones survive. */
export async function revokeExpiredSessions(userId: string): Promise<void> {
	await db
		.delete(sessions)
		.where(and(eq(sessions.userId, userId), sql`${sessions.expiresAt} <= now()`));
}
