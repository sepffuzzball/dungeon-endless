CREATE TYPE "public"."narration_status" AS ENUM('pending', 'streaming', 'complete', 'failed');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "company_name" text DEFAULT 'The Endless Company' NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ALTER COLUMN "species" TYPE text USING "species"::text;--> statement-breakpoint
DROP TYPE "public"."species";--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "meta" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "turns" ADD COLUMN "narration_status" "narration_status" DEFAULT 'complete' NOT NULL;--> statement-breakpoint
ALTER TABLE "turns" ADD COLUMN "narration_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "turns" ADD COLUMN "narration_updated_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE "species_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "species_definitions_name_normalized_check" CHECK (name_normalized = lower(name))
);--> statement-breakpoint
CREATE TABLE "calling_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calling_definitions_name_normalized_check" CHECK (name_normalized = lower(name))
);--> statement-breakpoint
CREATE TABLE "room_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"room_number" integer NOT NULL,
	"run_version" integer NOT NULL,
	"room_snapshot" jsonb NOT NULL,
	"prose" text DEFAULT '' NOT NULL,
	"status" "narration_status" DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_entries_room_number_positive" CHECK (room_number > 0),
	CONSTRAINT "room_entries_run_version_nonnegative" CHECK (run_version >= 0)
);--> statement-breakpoint
ALTER TABLE "room_entries" ADD CONSTRAINT "room_entries_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "species_definitions_name_normalized_unique" ON "species_definitions" USING btree ("name_normalized");--> statement-breakpoint
CREATE INDEX "species_definitions_enabled_idx" ON "species_definitions" USING btree ("enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "calling_definitions_name_normalized_unique" ON "calling_definitions" USING btree ("name_normalized");--> statement-breakpoint
CREATE INDEX "calling_definitions_enabled_idx" ON "calling_definitions" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "room_entries_run_id_idx" ON "room_entries" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "room_entries_run_id_room_number_unique" ON "room_entries" USING btree ("run_id", "room_number");--> statement-breakpoint
INSERT INTO "species_definitions" ("id", "name", "name_normalized") VALUES
	('20000000-0000-4000-8000-000000000001', 'Wolfen', 'wolfen'),
	('20000000-0000-4000-8000-000000000002', 'Foxen', 'foxen'),
	('20000000-0000-4000-8000-000000000003', 'Gnoll', 'gnoll'),
	('20000000-0000-4000-8000-000000000004', 'Human', 'human'),
	('20000000-0000-4000-8000-000000000005', 'Elf', 'elf'),
	('20000000-0000-4000-8000-000000000006', 'Dwarf', 'dwarf')
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "calling_definitions" ("id", "name", "name_normalized") VALUES
	('20000000-0000-4000-8000-000000000101', 'Rogue', 'rogue'),
	('20000000-0000-4000-8000-000000000102', 'Fighter', 'fighter'),
	('20000000-0000-4000-8000-000000000103', 'Wizard', 'wizard'),
	('20000000-0000-4000-8000-000000000104', 'Archer', 'archer'),
	('20000000-0000-4000-8000-000000000105', 'Spellblade', 'spellblade'),
	('20000000-0000-4000-8000-000000000106', 'Paladin', 'paladin'),
	('20000000-0000-4000-8000-000000000107', 'Hexblade', 'hexblade'),
	('20000000-0000-4000-8000-000000000108', 'Warden', 'warden'),
	('20000000-0000-4000-8000-000000000109', 'Arcanist', 'arcanist'),
	('20000000-0000-4000-8000-000000000110', 'Vagabond', 'vagabond')
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "room_entries" (
	"run_id", "room_number", "run_version", "room_snapshot", "prose", "status", "started_at", "updated_at"
)
SELECT
	"id", "room_number", "version", "room_data", COALESCE("room_data"->>'description', ''), 'complete', "started_at", now()
FROM "runs"
WHERE "status" = 'active'
ON CONFLICT ("run_id", "room_number") DO NOTHING;
