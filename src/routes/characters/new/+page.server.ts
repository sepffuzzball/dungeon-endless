import { fail, redirect } from '@sveltejs/kit';
import { requireUser } from '$lib/server/authorization';
import { assertSameOrigin } from '$lib/server/csrf';
import { db } from '$lib/server/db';
import { characters, speciesEnum } from '$lib/server/schema';
import type { Species } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

const CLASSES = ['Hexblade', 'Warden', 'Arcanist', 'Vagabond'] as const;
const SPECIES = speciesEnum.enumValues;

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
	return { species: SPECIES, classes: CLASSES };
};

export const actions: Actions = {
	default: async (event) => {
		assertSameOrigin(event);
		const user = requireUser(event);
		const form = await event.request.formData();
		const name = text(form, 'name');
		const title = text(form, 'title');
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
		if (!species || !SPECIES.includes(species as Species)) {
			return fail(400, { error: 'Choose an allowed species.' });
		}
		if (!className || className.length > 40) {
			return fail(400, { error: 'Calling must be between 1 and 40 characters.' });
		}
		if (age === null || age < 18 || age > 999) {
			return fail(400, { error: 'Age must be a whole number between 18 and 999.' });
		}
		if (!height || height.length > 40) {
			return fail(400, { error: 'Height must be between 1 and 40 characters.' });
		}
		if (!build || build.length > 40) {
			return fail(400, { error: 'Build must be between 1 and 40 characters.' });
		}
		// The existing form displays each allocation one higher than its persisted
		// 0..3 value. Accept that presentation shape while keeping the database
		// contract canonical; direct 0..3 submissions remain unchanged.
		const displayedStats = [submittedBody, submittedMind, submittedSpirit];
		const usesDisplayedBaseline =
			displayedStats.every((stat) => stat !== null && stat >= 1 && stat <= 4) &&
			displayedStats.reduce<number>((sum, stat) => sum + (stat ?? 0), 0) === 6;
		const body = submittedBody === null ? null : submittedBody - (usesDisplayedBaseline ? 1 : 0);
		const mind = submittedMind === null ? null : submittedMind - (usesDisplayedBaseline ? 1 : 0);
		const spirit =
			submittedSpirit === null ? null : submittedSpirit - (usesDisplayedBaseline ? 1 : 0);

		if (
			body === null ||
			mind === null ||
			spirit === null ||
			[body, mind, spirit].some((stat) => stat < 0 || stat > 3) ||
			body + mind + spirit !== 3
		) {
			return fail(400, {
				error: 'Body, Mind, and Spirit must each be 0 to 3 and total exactly 3.'
			});
		}

		await db.insert(characters).values({
			userId: user.id,
			name,
			title,
			age,
			height,
			build,
			species: species as Species,
			className,
			body,
			mind,
			spirit
		});

		throw redirect(303, '/characters');
	}
};
