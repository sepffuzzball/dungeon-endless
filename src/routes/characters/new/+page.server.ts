import { fail, redirect } from '@sveltejs/kit';
import { requireUser } from '$lib/server/authorization';
import { assertSameOrigin } from '$lib/server/csrf';
import { db } from '$lib/server/db';
import { callingDefinitions, characters, speciesDefinitions } from '$lib/server/schema';
import { BUILD_OPTIONS, HEIGHT_OPTIONS } from '$lib/types';
import { validCharacterAge, validImageUrl } from '$lib/server/game';
import { and, eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';

function text(form: FormData, name: string): string | null {
	const value = form.get(name);
	return typeof value === 'string' ? value.trim() : null;
}

function integer(form: FormData, name: string): number | null {
	const value = text(form, name);
	if (value === null || !/^-?\d+$/.test(value)) return null;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) ? parsed : null;
}

export const load: PageServerLoad = async (event) => {
	requireUser(event);
	const [species, callings] = await Promise.all([
		db
			.select({ name: speciesDefinitions.name, description: speciesDefinitions.description })
			.from(speciesDefinitions)
			.where(eq(speciesDefinitions.enabled, true))
			.orderBy(speciesDefinitions.name),
		db
			.select({ name: callingDefinitions.name, description: callingDefinitions.description })
			.from(callingDefinitions)
			.where(eq(callingDefinitions.enabled, true))
			.orderBy(callingDefinitions.name)
	]);
	return { species, callings, buildOptions: BUILD_OPTIONS, heightOptions: HEIGHT_OPTIONS };
};

export const actions: Actions = {
	default: async (event) => {
		assertSameOrigin(event);
		const user = requireUser(event);
		const form = await event.request.formData();
		const name = text(form, 'name');
		const title = text(form, 'title');
		const description = text(form, 'description');
		const imageUrl = text(form, 'imageUrl');
		const species = text(form, 'species');
		const className = text(form, 'className');
		const age = integer(form, 'age');
		const height = text(form, 'height');
		const build = text(form, 'build');
		const submittedBody = integer(form, 'body');
		const submittedMind = integer(form, 'mind');
		const submittedSpirit = integer(form, 'spirit');

		if (!name || name.length > 40) {
			return fail(400, { error: 'Name must be between 1 and 40 characters.' });
		}
		if (title === null || title.length > 60) {
			return fail(400, { error: 'Title must be no more than 60 characters.' });
		}
		if (description === null || description.length > 2000)
			return fail(400, { error: 'Description must be no more than 2000 characters.' });
		if (!species) return fail(400, { error: 'Choose an enabled species.' });
		if (!className) return fail(400, { error: 'Choose an enabled calling.' });
		if (age === null || !validCharacterAge(age)) {
			return fail(400, { error: 'Age must be a whole number between 1 and 999.' });
		}
		if (imageUrl && !validImageUrl(imageUrl))
			return fail(400, {
				error: 'Image URL must be an http or https URL of at most 2048 characters.'
			});
		if (!height || !HEIGHT_OPTIONS.includes(height as (typeof HEIGHT_OPTIONS)[number])) {
			return fail(400, { error: 'Choose an allowed height.' });
		}
		if (!build || !BUILD_OPTIONS.includes(build as (typeof BUILD_OPTIONS)[number])) {
			return fail(400, { error: 'Choose an allowed build.' });
		}
		if (
			submittedBody === null ||
			submittedMind === null ||
			submittedSpirit === null ||
			[submittedBody, submittedMind, submittedSpirit].some((stat) => stat < 0 || stat > 1) ||
			submittedBody + submittedMind + submittedSpirit !== 1
		) {
			return fail(400, {
				error: 'Body, Mind, and Spirit must each be 0 or 1 and total exactly 1.'
			});
		}

		const [[speciesDefinition], [callingDefinition]] = await Promise.all([
			db
				.select({ name: speciesDefinitions.name })
				.from(speciesDefinitions)
				.where(and(eq(speciesDefinitions.name, species), eq(speciesDefinitions.enabled, true)))
				.limit(1),
			db
				.select({ name: callingDefinitions.name })
				.from(callingDefinitions)
				.where(and(eq(callingDefinitions.name, className), eq(callingDefinitions.enabled, true)))
				.limit(1)
		]);
		if (!speciesDefinition)
			return fail(400, {
				error: 'That species is no longer available. Choose an enabled species.'
			});
		if (!callingDefinition)
			return fail(400, {
				error: 'That calling is no longer available. Choose an enabled calling.'
			});

		await db.insert(characters).values({
			userId: user.id,
			name,
			title,
			description,
			imageUrl: imageUrl || null,
			age,
			height,
			build,
			species: speciesDefinition.name,
			className: callingDefinition.name,
			body: submittedBody,
			mind: submittedMind,
			spirit: submittedSpirit
		});

		throw redirect(303, '/characters');
	}
};
