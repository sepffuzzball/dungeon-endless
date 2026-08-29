import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

/**
 * Verifies a state-changing request is same-origin (Origin or Referer matches
 * the request's exact scheme and host).
 * This is the primary CSRF defence for cookie-authenticated mutations.
 */
export function assertSameOrigin(event: RequestEvent): void {
	const origin = event.request.headers.get('origin');
	if (origin) {
		let originUrl: URL;
		try {
			originUrl = new URL(origin);
		} catch {
			throw error(403, 'Cross-origin request rejected');
		}
		if (originUrl.origin !== event.url.origin) throw error(403, 'Cross-origin request rejected');
		return;
	}

	const referer = event.request.headers.get('referer');
	if (referer) {
		let refererUrl: URL;
		try {
			refererUrl = new URL(referer);
		} catch {
			throw error(403, 'Cross-origin request rejected');
		}
		if (refererUrl.origin !== event.url.origin) throw error(403, 'Cross-origin request rejected');
		return;
	}

	throw error(403, 'Missing Origin or Referer header');
}
