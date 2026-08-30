import { and, eq } from 'drizzle-orm';
import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { requireUser } from '$lib/server/authorization';
import { retirementConfirmed } from '$lib/server/character-lifecycle';
import { assertSameOrigin } from '$lib/server/csrf';
import { db } from '$lib/server/db';
import { normalizeCharacterIdentity, validCharacterAge, validImageUrl } from '$lib/server/game';
import { callingDefinitions, characters, runs, speciesDefinitions } from '$lib/server/schema';
import { BUILD_OPTIONS, HEIGHT_OPTIONS } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

const uuidSchema = z.string().uuid();
const text = (form: FormData, name: string) => {
	const value = form.get(name);
	return typeof value === 'string' ? value.trim() : null;
};

async function ownedCharacter(id: string, userId: string) {
	return (
		await db
			.select()
			.from(characters)
			.where(and(eq(characters.id, id), eq(characters.userId, userId)))
			.limit(1)
	)[0];
}

export const load: PageServerLoad = async (event) => {
	const user = requireUser(event);
	const id = uuidSchema.safeParse(event.params.characterId);
	if (!id.success) throw error(404, 'Character not found');
	const [character, species, callings] = await Promise.all([
		ownedCharacter(id.data, user.id),
		db
			.select({ name: speciesDefinitions.name, enabled: speciesDefinitions.enabled })
			.from(speciesDefinitions)
			.orderBy(speciesDefinitions.name),
		db
			.select({ name: callingDefinitions.name, enabled: callingDefinitions.enabled })
			.from(callingDefinitions)
			.orderBy(callingDefinitions.name)
	]);
	if (!character) throw error(404, 'Character not found');
	return {
		character,
		species,
		callings,
		buildOptions: BUILD_OPTIONS,
		heightOptions: HEIGHT_OPTIONS
	};
};

export const actions: Actions = {
	save: async (event) => {
		assertSameOrigin(event);
		const user = requireUser(event);
		const id = uuidSchema.safeParse(event.params.characterId);
		if (!id.success) return fail(400, { error: 'Invalid character.' });
		const existing = await ownedCharacter(id.data, user.id);
		if (!existing) return fail(404, { error: 'Character not found.' });
		if (existing.retiredAt)
			return fail(409, { error: 'Retired character profiles are read-only.' });
		const form = await event.request.formData();
		const name = text(form, 'name');
		const title = text(form, 'title');
		const description = text(form, 'description');
		const pronouns = normalizeCharacterIdentity(text(form, 'pronouns'));
		const genderIdentity = normalizeCharacterIdentity(text(form, 'genderIdentity'));
		const imageUrl = text(form, 'imageUrl');
		const species = text(form, 'species');
		const className = text(form, 'className');
		const height = text(form, 'height');
		const build = text(form, 'build');
		const ageRaw = text(form, 'age');
		const age = ageRaw && /^\d+$/.test(ageRaw) ? Number(ageRaw) : NaN;
		if (!name || name.length > 40)
			return fail(400, { error: 'Name must be between 1 and 40 characters.' });
		if (title === null || title.length > 60 || description === null || description.length > 2000)
			return fail(400, { error: 'Title or description is too long.' });
		if (!pronouns || !genderIdentity)
			return fail(400, {
				error:
					'Pronouns and gender / presentation must each be 1 to 80 characters without control characters.'
			});
		if (!validCharacterAge(age))
			return fail(400, { error: 'Age must be a whole number between 1 and 999.' });
		if (imageUrl && !validImageUrl(imageUrl))
			return fail(400, {
				error: 'Image URL must be an http or https URL of at most 2048 characters.'
			});
		if (
			!height ||
			!HEIGHT_OPTIONS.includes(height as (typeof HEIGHT_OPTIONS)[number]) ||
			!build ||
			!BUILD_OPTIONS.includes(build as (typeof BUILD_OPTIONS)[number])
		)
			return fail(400, { error: 'Choose an allowed height and build.' });
		if (!species || !className) return fail(400, { error: 'Choose a species and calling.' });
		if (species !== existing.species) {
			const enabled = await db
				.select({ name: speciesDefinitions.name })
				.from(speciesDefinitions)
				.where(and(eq(speciesDefinitions.name, species), eq(speciesDefinitions.enabled, true)))
				.limit(1);
			if (!enabled.length) return fail(400, { error: 'Choose an enabled species.' });
		}
		if (className !== existing.className) {
			const enabled = await db
				.select({ name: callingDefinitions.name })
				.from(callingDefinitions)
				.where(and(eq(callingDefinitions.name, className), eq(callingDefinitions.enabled, true)))
				.limit(1);
			if (!enabled.length) return fail(400, { error: 'Choose an enabled calling.' });
		}
		const mutation = await db.transaction(async (tx) => {
			const [character] = await tx
				.select({ id: characters.id, retiredAt: characters.retiredAt })
				.from(characters)
				.where(and(eq(characters.id, id.data), eq(characters.userId, user.id)))
				.limit(1)
				.for('update');
			if (!character) return { error: 'Character not found.', status: 404 };
			if (character.retiredAt)
				return { error: 'Retired character profiles are read-only.', status: 409 };
			await tx
				.update(characters)
				.set({
					name,
					title,
					description,
					pronouns,
					genderIdentity,
					age,
					height,
					build,
					species,
					className,
					imageUrl: imageUrl || null,
					updatedAt: new Date()
				})
				.where(and(eq(characters.id, character.id), eq(characters.userId, user.id)));
			return null;
		});
		if (mutation) return fail(mutation.status, { error: mutation.error });
		throw redirect(303, '/characters');
	},
	retire: async (event) => {
		assertSameOrigin(event);
		const user = requireUser(event);
		const id = uuidSchema.safeParse(event.params.characterId);
		if (!id.success) return fail(400, { error: 'Invalid character.' });
		const form = await event.request.formData();
		const confirmationName = text(form, 'confirmationName');
		const confirmed = form.get('confirmRetirement') === 'yes';

		type Result = { error: string; status: number } | { retired: boolean };
		const result = await db.transaction(async (tx): Promise<Result> => {
			// Retirement uses the same character-first lock order as expedition start and upgrades.
			const [character] = await tx
				.select()
				.from(characters)
				.where(and(eq(characters.id, id.data), eq(characters.userId, user.id)))
				.limit(1)
				.for('update');
			if (!character) return { error: 'Character not found.', status: 404 };
			if (character.retiredAt) return { retired: false };
			const [active] = await tx
				.select({ id: runs.id })
				.from(runs)
				.where(and(eq(runs.characterId, character.id), eq(runs.status, 'active')))
				.limit(1);
			if (active)
				return {
					error: 'Finish or abandon the active expedition before retiring this character.',
					status: 409
				};
			if (!retirementConfirmed(character.name, confirmationName, confirmed))
				return {
					error: 'Confirm retirement and enter the character name exactly as shown.',
					status: 400
				};
			const now = new Date();
			await tx
				.update(characters)
				.set({ retiredAt: now, updatedAt: now })
				.where(and(eq(characters.id, character.id), eq(characters.userId, user.id)));
			return { retired: true };
		});
		if ('error' in result) return fail(result.status, { error: result.error });
		throw redirect(303, '/characters');
	}
};
