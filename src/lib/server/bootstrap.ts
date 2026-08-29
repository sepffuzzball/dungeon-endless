import { hash } from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { config } from './config';
import { db } from './db';
import { users } from './schema';
import { normalizeUsername } from './validation';

const BOOTSTRAP_ROUNDS = 12;

/**
 * Creates the bootstrap admin from environment variables, but only when no
 * admin exists yet. Never resets or modifies an existing admin account.
 */
async function bootstrapAdmin(): Promise<void> {
	const [existing] = await db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.role, 'admin'))
		.limit(1);
	if (existing) {
		console.log('bootstrap: an admin already exists; leaving it unchanged.');
		return;
	}

	if (!config.BOOTSTRAP_ADMIN_USERNAME || !config.BOOTSTRAP_ADMIN_PASSWORD) {
		throw new Error(
			'BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD are required when no admin exists'
		);
	}

	const username = normalizeUsername(config.BOOTSTRAP_ADMIN_USERNAME);
	if (!username) {
		throw new Error('BOOTSTRAP_ADMIN_USERNAME must not be empty when no admin exists');
	}
	const passwordBytes = Buffer.byteLength(config.BOOTSTRAP_ADMIN_PASSWORD, 'utf8');
	if (passwordBytes < 12 || passwordBytes > 72) {
		throw new Error('BOOTSTRAP_ADMIN_PASSWORD must be 12 to 72 UTF-8 bytes when no admin exists');
	}
	const passwordHash = await hash(config.BOOTSTRAP_ADMIN_PASSWORD, BOOTSTRAP_ROUNDS);

	await db.insert(users).values({
		username,
		passwordHash,
		role: 'admin',
		mustChangePassword: true
	});
	console.log(`bootstrap: created admin user "${username}".`);
}

bootstrapAdmin()
	.then(() => process.exit(0))
	.catch((err: unknown) => {
		console.error(`bootstrap failed: ${err instanceof Error ? err.message : String(err)}`);
		process.exit(1);
	});
