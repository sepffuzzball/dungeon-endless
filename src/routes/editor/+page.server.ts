import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireRole } from '$lib/server/authorization';
import { assertSameOrigin } from '$lib/server/csrf';
import { db } from '$lib/server/db';
import { monsters, traps } from '$lib/server/schema';
import { SKILLS } from '$lib/types';
import type { RequestEvent } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const contentSchema = z.object({
	name: z.string().trim().min(1, 'Name is required.').max(120, 'Name is too long.'),
	description: z
		.string()
		.trim()
		.min(1, 'Description is required.')
		.max(10_000, 'Description is too long.'),
	enabled: z.boolean()
});

const monsterSchema = contentSchema.extend({
	debauchedDescription: z.string().trim().max(10_000, 'Debauched description is too long.'),
	defense: z.coerce.number().int().min(1).max(1_000)
});

const trapSchema = contentSchema.extend({
	skill: z.enum(SKILLS as [(typeof SKILLS)[number], ...typeof SKILLS])
});

const idSchema = z.string().uuid();

function authorize(event: RequestEvent): void {
	requireRole(event, ['editor', 'admin']);
}

function authorizeAction(event: RequestEvent): void {
	assertSameOrigin(event);
	authorize(event);
}

function databaseFailure(): ReturnType<typeof fail> {
	return fail(500, { error: 'The archive could not be updated. Please try again.' });
}

export const load: PageServerLoad = async (event) => {
	authorize(event);
	const [monsterRows, trapRows] = await Promise.all([
		db.select().from(monsters).orderBy(monsters.name),
		db.select().from(traps).orderBy(traps.name)
	]);
	return { monsters: monsterRows, traps: trapRows };
};

export const actions: Actions = {
	monster: async (event) => {
		authorizeAction(event);
		const form = await event.request.formData();
		const parsed = monsterSchema.safeParse({
			name: form.get('name'),
			description: form.get('description'),
			debauchedDescription: form.get('debauchedDescription') ?? '',
			defense: form.get('defense'),
			enabled: form.get('enabled') === 'on'
		});
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Invalid monster details.' });
		}
		try {
			await db.insert(monsters).values(parsed.data);
			return { success: 'Monster added to the bestiary.' };
		} catch {
			return databaseFailure();
		}
	},
	trap: async (event) => {
		authorizeAction(event);
		const form = await event.request.formData();
		const parsed = trapSchema.safeParse({
			name: form.get('name'),
			description: form.get('description'),
			skill: form.get('skill'),
			enabled: form.get('enabled') === 'on'
		});
		if (!parsed.success) {
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Invalid trap details.' });
		}
		try {
			await db.insert(traps).values(parsed.data);
			return { success: 'Trap added to the hazards.' };
		} catch {
			return databaseFailure();
		}
	},
	'toggle-monster': async (event) => {
		authorizeAction(event);
		const form = await event.request.formData();
		const id = idSchema.safeParse(form.get('id'));
		if (!id.success) return fail(400, { error: 'Invalid monster selection.' });
		try {
			const [row] = await db
				.select({ enabled: monsters.enabled })
				.from(monsters)
				.where(eq(monsters.id, id.data))
				.limit(1);
			if (!row) return fail(404, { error: 'Monster not found.' });
			await db
				.update(monsters)
				.set({ enabled: !row.enabled, updatedAt: new Date() })
				.where(eq(monsters.id, id.data));
			return { success: `Monster ${row.enabled ? 'disabled' : 'enabled'}.` };
		} catch {
			return databaseFailure();
		}
	},
	'toggle-trap': async (event) => {
		authorizeAction(event);
		const form = await event.request.formData();
		const id = idSchema.safeParse(form.get('id'));
		if (!id.success) return fail(400, { error: 'Invalid trap selection.' });
		try {
			const [row] = await db
				.select({ enabled: traps.enabled })
				.from(traps)
				.where(eq(traps.id, id.data))
				.limit(1);
			if (!row) return fail(404, { error: 'Trap not found.' });
			await db
				.update(traps)
				.set({ enabled: !row.enabled, updatedAt: new Date() })
				.where(eq(traps.id, id.data));
			return { success: `Trap ${row.enabled ? 'disabled' : 'enabled'}.` };
		} catch {
			return databaseFailure();
		}
	}
};
