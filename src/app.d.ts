import type { SafeSession, SafeUser } from '$lib/types';

declare global {
	namespace App {
		interface Locals {
			user?: SafeUser;
			session?: SafeSession;
		}
	}
}

export {};
