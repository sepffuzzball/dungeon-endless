import { eq } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import { requireUser } from '$lib/server/authorization';
import { assertSameOrigin } from '$lib/server/csrf';
import { db } from '$lib/server/db';
import { users } from '$lib/server/schema';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const user = requireUser(event);
	return {
		companyName: user.companyName ?? 'The Endless Company',
		brutality: user.brutality ?? 3,
		debauchery: user.debauchery ?? 3
	};
};

export const actions: Actions = {
	default: async (event) => {
		assertSameOrigin(event);
		const user = requireUser(event);
		const form = await event.request.formData();
		const companyName = String(form.get('companyName') ?? '').trim();
		const brutality = Number(form.get('brutality'));
		const debauchery = Number(form.get('debauchery'));
		if (companyName.length < 1 || companyName.length > 80) {
			return fail(400, { error: 'Company name must be between 1 and 80 characters.' });
		}
		if (
			![brutality, debauchery].every((value) => Number.isInteger(value) && value >= 1 && value <= 5)
		)
			return fail(400, { error: 'Brutality and debauchery must be whole numbers from 1 to 5.' });
		try {
			await db
				.update(users)
				.set({ companyName, brutality, debauchery, updatedAt: new Date() })
				.where(eq(users.id, user.id));
			event.locals.user = { ...user, companyName, brutality, debauchery };
			return { success: 'Company settings updated.' };
		} catch {
			return fail(500, { error: 'Settings could not be saved. Please try again.' });
		}
	}
};
