import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireRole } from '$lib/server/authorization';
import { assertSameOrigin } from '$lib/server/csrf';
import { db } from '$lib/server/db';
import { callingDefinitions, monsters, speciesDefinitions, traps } from '$lib/server/schema';
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
	tier: z.coerce.number().int().min(1).max(10),
	hp: z.coerce.number().int().min(1).max(1_000),
	defense: z.coerce.number().int().min(1).max(1_000),
	temperament: z.string().trim().max(2_000, 'Temperament is too long.')
});

const trapSchema = contentSchema.extend({
	tier: z.coerce.number().int().min(1).max(10),
	target: z.coerce.number().int().min(1).max(1_000),
	skill: z.enum(SKILLS as [(typeof SKILLS)[number], ...typeof SKILLS]),
	consequence: z.string().trim().max(2_000, 'Consequence is too long.')
});

const definitionSchema = z.object({
	name: z.string().trim().min(1, 'Name is required.').max(80, 'Name is too long.'),
	description: z.string().trim().max(2_000, 'Description is too long.'),
	enabled: z.boolean()
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

function desiredEnabled(form: FormData): boolean | null {
	const value = form.get('enabled');
	return value === 'true' ? true : value === 'false' ? false : null;
}

function isUniqueViolation(error: unknown): boolean {
	return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

export const load: PageServerLoad = async (event) => {
	authorize(event);
	const [monsterRows, trapRows, speciesRows, callingRows] = await Promise.all([
		db.select().from(monsters).orderBy(monsters.name),
		db.select().from(traps).orderBy(traps.name),
		db.select().from(speciesDefinitions).orderBy(speciesDefinitions.name),
		db.select().from(callingDefinitions).orderBy(callingDefinitions.name)
	]);
	return { monsters: monsterRows, traps: trapRows, species: speciesRows, callings: callingRows };
};

export const actions: Actions = {
	monster: async (event) => {
		authorizeAction(event);
		const form = await event.request.formData();
		const parsed = monsterSchema.safeParse({
			name: form.get('name'),
			description: form.get('description'),
			debauchedDescription: form.get('debauchedDescription') ?? '',
			tier: form.get('tier'),
			hp: form.get('hp'),
			defense: form.get('defense'),
			temperament: form.get('temperament') ?? '',
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
			tier: form.get('tier'),
			target: form.get('target'),
			skill: form.get('skill'),
			consequence: form.get('consequence') ?? '',
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
	'edit-monster': async (event) => {
		authorizeAction(event);
		const form = await event.request.formData();
		const id = idSchema.safeParse(form.get('id'));
		const parsed = monsterSchema.safeParse({
			name: form.get('name'),
			tier: form.get('tier'),
			hp: form.get('hp'),
			defense: form.get('defense'),
			temperament: form.get('temperament') ?? '',
			description: form.get('description'),
			debauchedDescription: form.get('debauchedDescription') ?? '',
			enabled: form.get('enabled') === 'on'
		});
		if (!id.success || !parsed.success)
			return fail(400, {
				error: parsed.success ? 'Invalid monster selection.' : parsed.error.issues[0]?.message
			});
		try {
			const rows = await db
				.update(monsters)
				.set({ ...parsed.data, updatedAt: new Date() })
				.where(eq(monsters.id, id.data))
				.returning({ id: monsters.id });
			if (!rows.length) return fail(404, { error: 'Monster not found.' });
			return { success: 'Monster updated. Existing room snapshots were not changed.' };
		} catch {
			return databaseFailure();
		}
	},
	'edit-trap': async (event) => {
		authorizeAction(event);
		const form = await event.request.formData();
		const id = idSchema.safeParse(form.get('id'));
		const parsed = trapSchema.safeParse({
			name: form.get('name'),
			tier: form.get('tier'),
			target: form.get('target'),
			skill: form.get('skill'),
			consequence: form.get('consequence') ?? '',
			description: form.get('description'),
			enabled: form.get('enabled') === 'on'
		});
		if (!id.success || !parsed.success)
			return fail(400, {
				error: parsed.success ? 'Invalid trap selection.' : parsed.error.issues[0]?.message
			});
		try {
			const rows = await db
				.update(traps)
				.set({ ...parsed.data, updatedAt: new Date() })
				.where(eq(traps.id, id.data))
				.returning({ id: traps.id });
			if (!rows.length) return fail(404, { error: 'Trap not found.' });
			return { success: 'Trap updated. Existing room snapshots were not changed.' };
		} catch {
			return databaseFailure();
		}
	},
	'toggle-monster': async (event) => {
		authorizeAction(event);
		const form = await event.request.formData();
		const id = idSchema.safeParse(form.get('id'));
		const enabled = desiredEnabled(form);
		if (!id.success || enabled === null) return fail(400, { error: 'Invalid monster selection.' });
		try {
			const rows = await db
				.update(monsters)
				.set({ enabled, updatedAt: new Date() })
				.where(eq(monsters.id, id.data))
				.returning({ id: monsters.id });
			if (!rows.length) return fail(404, { error: 'Monster not found.' });
			return { success: `Monster ${enabled ? 'enabled' : 'disabled'}.` };
		} catch {
			return databaseFailure();
		}
	},
	'toggle-trap': async (event) => {
		authorizeAction(event);
		const form = await event.request.formData();
		const id = idSchema.safeParse(form.get('id'));
		const enabled = desiredEnabled(form);
		if (!id.success || enabled === null) return fail(400, { error: 'Invalid trap selection.' });
		try {
			const rows = await db
				.update(traps)
				.set({ enabled, updatedAt: new Date() })
				.where(eq(traps.id, id.data))
				.returning({ id: traps.id });
			if (!rows.length) return fail(404, { error: 'Trap not found.' });
			return { success: `Trap ${enabled ? 'enabled' : 'disabled'}.` };
		} catch {
			return databaseFailure();
		}
	},
	definition: async (event) => {
		authorizeAction(event);
		const form = await event.request.formData();
		const kind = form.get('kind');
		const parsed = definitionSchema.safeParse({
			name: form.get('name'),
			description: form.get('description') ?? '',
			enabled: form.get('enabled') === 'on'
		});
		if ((kind !== 'species' && kind !== 'calling') || !parsed.success)
			return fail(400, {
				error: parsed.success ? 'Invalid definition type.' : parsed.error.issues[0]?.message
			});
		const table = kind === 'species' ? speciesDefinitions : callingDefinitions;
		try {
			await db
				.insert(table)
				.values({ ...parsed.data, nameNormalized: parsed.data.name.toLowerCase() });
			return { success: `${kind === 'species' ? 'Species' : 'Calling'} added.` };
		} catch (error) {
			if (isUniqueViolation(error))
				return fail(409, {
					error: `That ${kind} name already exists (names are case-insensitive).`
				});
			return databaseFailure();
		}
	},
	'edit-definition': async (event) => {
		authorizeAction(event);
		const form = await event.request.formData();
		const kind = form.get('kind');
		const id = idSchema.safeParse(form.get('id'));
		const parsed = definitionSchema.safeParse({
			name: form.get('name'),
			description: form.get('description') ?? '',
			enabled: form.get('enabled') === 'on'
		});
		if ((kind !== 'species' && kind !== 'calling') || !id.success || !parsed.success)
			return fail(400, {
				error: !parsed.success ? parsed.error.issues[0]?.message : 'Invalid definition selection.'
			});
		const table = kind === 'species' ? speciesDefinitions : callingDefinitions;
		try {
			const rows = await db
				.update(table)
				.set({
					...parsed.data,
					nameNormalized: parsed.data.name.toLowerCase(),
					updatedAt: new Date()
				})
				.where(eq(table.id, id.data))
				.returning({ id: table.id });
			if (!rows.length) return fail(404, { error: 'Definition not found.' });
			return {
				success: `${kind === 'species' ? 'Species' : 'Calling'} updated. Existing characters keep their saved choice.`
			};
		} catch (error) {
			if (isUniqueViolation(error))
				return fail(409, {
					error: `That ${kind} name already exists (names are case-insensitive).`
				});
			return databaseFailure();
		}
	},
	'toggle-definition': async (event) => {
		authorizeAction(event);
		const form = await event.request.formData();
		const kind = form.get('kind');
		const id = idSchema.safeParse(form.get('id'));
		const enabled = desiredEnabled(form);
		if ((kind !== 'species' && kind !== 'calling') || !id.success || enabled === null)
			return fail(400, { error: 'Invalid definition selection.' });
		const table = kind === 'species' ? speciesDefinitions : callingDefinitions;
		try {
			const rows = await db
				.update(table)
				.set({ enabled, updatedAt: new Date() })
				.where(eq(table.id, id.data))
				.returning({ id: table.id });
			if (!rows.length) return fail(404, { error: 'Definition not found.' });
			return {
				success: `${kind === 'species' ? 'Species' : 'Calling'} ${enabled ? 'enabled' : 'disabled'}.`
			};
		} catch {
			return databaseFailure();
		}
	}
};
