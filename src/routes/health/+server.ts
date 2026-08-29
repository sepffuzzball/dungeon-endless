import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';

export const GET: RequestHandler = async () => {
	let database = 'down';
	try {
		await db.execute(sql`select 1`);
		database = 'up';
	} catch {
		database = 'down';
	}

	const healthy = database === 'up';
	return json(
		{
			status: healthy ? 'ok' : 'degraded',
			liveness: 'ok',
			database,
			time: new Date().toISOString()
		},
		{ status: healthy ? 200 : 503 }
	);
};
