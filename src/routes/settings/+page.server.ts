import { eq } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import { requireUser } from '$lib/server/authorization';
import { assertSameOrigin } from '$lib/server/csrf';
import { db } from '$lib/server/db';
import { users } from '$lib/server/schema';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const user = requireUser(event);
	return { companyName: user.companyName ?? 'The Endless Company' };
};

export const actions: Actions = {
	default: async (event) => {
		assertSameOrigin(event);
		const user = requireUser(event);
		const form = await event.request.formData();
		const companyName = String(form.get('companyName') ?? '').trim();
		if (companyName.length < 1 || companyName.length > 80) {
			return fail(400, { error: 'Company name must be between 1 and 80 characters.' });
		}
		try {
			await db
				.update(users)
				.set({ companyName, updatedAt: new Date() })
				.where(eq(users.id, user.id));
			event.locals.user = { ...user, companyName };
			return { success: 'Company name updated.' };
		} catch {
			return fail(500, { error: 'Settings could not be saved. Please try again.' });
		}
	}
};
