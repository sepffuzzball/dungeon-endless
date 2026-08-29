ALTER TABLE "characters" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "gear_bonus" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "max_start_room" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "company_gold" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "brutality" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "debauchery" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
-- Single-writer cutover: stop application writes before applying this migration. The
-- migration runner wraps the file in one transaction, so wallet backfill, validation,
-- and achievement seeding become visible together.
UPDATE "characters"
SET "level" = "body" + "mind" + "spirit"
WHERE "body" + "mind" + "spirit" BETWEEN 1 AND 10
  AND "level" <> "body" + "mind" + "spirit";--> statement-breakpoint
-- Preflight: refuse the wallet backfill unless legacy character gold is clean and
-- each per-user total stays within the Drizzle bigint-number safe range
-- (9007199254740991), so backfilled wallets always satisfy the new DB checks.
DO $$
DECLARE
	negative_count bigint;
	over_limit_users bigint;
BEGIN
	SELECT count(*) INTO negative_count
	FROM "characters"
	WHERE "persistent_gold" < 0;
	IF negative_count > 0 THEN
		RAISE EXCEPTION 'Wallet backfill aborted: % character(s) have negative persistent_gold.', negative_count;
	END IF;
	SELECT count(*) INTO over_limit_users
	FROM (
		SELECT u."id"
		FROM "users" AS u
		JOIN "characters" AS c ON c."user_id" = u."id"
		GROUP BY u."id"
		HAVING SUM(c."persistent_gold") > 9007199254740991
	) AS over;
	IF over_limit_users > 0 THEN
		RAISE EXCEPTION 'Wallet backfill aborted: % user(s) have a persistent_gold sum above the safe limit 9007199254740991.', over_limit_users;
	END IF;
END $$;--> statement-breakpoint
UPDATE "users" AS u
SET "company_gold" = balances.total_gold
FROM (
	SELECT u2."id", COALESCE(SUM(c."persistent_gold"), 0)::bigint AS total_gold
	FROM "users" AS u2
	LEFT JOIN "characters" AS c ON c."user_id" = u2."id"
	GROUP BY u2."id"
) AS balances
WHERE u."id" = balances."id";--> statement-breakpoint
INSERT INTO "achievements" ("key", "name", "description") VALUES
	('gold-100', 'Pocket of Gold', 'Accumulate 100 gold.'),
	('gold-1000', 'A King''s Ransom', 'Accumulate 1000 gold.')
ON CONFLICT ("key") DO UPDATE SET "name" = EXCLUDED."name", "description" = EXCLUDED."description";--> statement-breakpoint
INSERT INTO "user_achievements" ("user_id", "achievement_id")
SELECT u."id", a."id"
FROM "users" AS u
JOIN "achievements" AS a ON
	(a."key" = 'gold-100' AND u."company_gold" >= 100)
	OR (a."key" = 'gold-1000' AND u."company_gold" >= 1000)
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_age_range" CHECK ("characters"."age" between 1 and 999);--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_level_range" CHECK ("characters"."level" between 1 and 10);--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_body_range" CHECK ("characters"."body" between 0 and 4);--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_mind_range" CHECK ("characters"."mind" between 0 and 4);--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_spirit_range" CHECK ("characters"."spirit" between 0 and 4);--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_gear_bonus_range" CHECK ("characters"."gear_bonus" between 0 and 3);--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_max_start_room_range" CHECK ("characters"."max_start_room" between 1 and 1000);--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_valid_stat_allocation" CHECK ("characters"."body" + "characters"."mind" + "characters"."spirit" = "characters"."level"
				and (("characters"."level" < 10 and greatest("characters"."body", "characters"."mind", "characters"."spirit") <= 3)
				or ("characters"."level" = 10 and greatest("characters"."body", "characters"."mind", "characters"."spirit") <= 4
				and (("characters"."body" = 4)::int + ("characters"."mind" = 4)::int + ("characters"."spirit" = 4)::int) <= 1)));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_company_gold_nonnegative" CHECK ("users"."company_gold" >= 0);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_company_gold_safe_integer" CHECK ("users"."company_gold" <= 9007199254740991);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_brutality_range" CHECK ("users"."brutality" between 1 and 5);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_debauchery_range" CHECK ("users"."debauchery" between 1 and 5);
