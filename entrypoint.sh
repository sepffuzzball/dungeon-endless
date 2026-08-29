#!/bin/sh
set -e

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${APP_ENCRYPTION_KEY:?APP_ENCRYPTION_KEY is required}"

apply_migrations() {
	echo "Applying database migrations..."
	npm run db:migrate
}

bootstrap() {
	echo "Bootstrapping admin user..."
	npm run bootstrap
}

apply_migrations
bootstrap

echo "Starting Dungeon Endless on port ${PORT:-3000}..."
exec node build/index.js
