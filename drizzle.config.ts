import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	dialect: 'postgresql',
	schema: './src/lib/server/schema.ts',
	out: './migrations',
	dbCredentials: {
		url: process.env.DATABASE_URL ?? 'postgres://dungeon:dungeon@localhost:5432/dungeon'
	},
	migrations: {
		table: 'drizzle_migrations',
		schema: 'public'
	},
	verbose: true,
	strict: true
});
