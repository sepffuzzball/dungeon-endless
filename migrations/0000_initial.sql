CREATE TYPE "public"."llm_purpose" AS ENUM('prose', 'interpretation', 'summary', 'suggestions');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'editor', 'admin');--> statement-breakpoint
CREATE TYPE "public"."room_type" AS ENUM('monster', 'trap', 'treasure', 'rest', 'boss');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('active', 'defeated', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."skill" AS ENUM('Athletics', 'Knowledge', 'Magic', 'Persuasion', 'Stealth', 'Willpower');--> statement-breakpoint
CREATE TYPE "public"."species" AS ENUM('Wolfen', 'Foxen', 'Gnoll', 'Human', 'Elf', 'Dwarf');--> statement-breakpoint
CREATE TABLE "achievements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"age" integer NOT NULL,
	"height" text DEFAULT '' NOT NULL,
	"build" text DEFAULT '' NOT NULL,
	"species" "species" NOT NULL,
	"class_name" text NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"body" integer NOT NULL,
	"mind" integer NOT NULL,
	"spirit" integer NOT NULL,
	"persistent_gold" integer DEFAULT 0 NOT NULL,
	"furthest_floor" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"purpose" "llm_purpose" DEFAULT 'prose' NOT NULL,
	"base_url" text NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"api_key_enc" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"timeout_ms" integer DEFAULT 20000 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monsters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"tier" integer DEFAULT 1 NOT NULL,
	"hp" integer DEFAULT 8 NOT NULL,
	"defense" integer NOT NULL,
	"temperament" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"debauched_description" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"status" "run_status" DEFAULT 'active' NOT NULL,
	"seed" text NOT NULL,
	"rules_version" integer DEFAULT 1 NOT NULL,
	"room_number" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"hp" integer NOT NULL,
	"max_hp" integer NOT NULL,
	"brutality" integer DEFAULT 0 NOT NULL,
	"debauchery" integer DEFAULT 0 NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"room_type" "room_type" DEFAULT 'treasure' NOT NULL,
	"room_data" jsonb NOT NULL,
	"inventory" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "traps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"tier" integer DEFAULT 1 NOT NULL,
	"target" integer DEFAULT 8 NOT NULL,
	"skill" "skill" NOT NULL,
	"consequence" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"action_key" text NOT NULL,
	"action_text" text DEFAULT '' NOT NULL,
	"intent" jsonb NOT NULL,
	"room_snapshot" jsonb NOT NULL,
	"rolls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outcome" jsonb NOT NULL,
	"narration" text DEFAULT '' NOT NULL,
	"turn_summary" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_achievements" (
	"user_id" uuid NOT NULL,
	"achievement_id" uuid NOT NULL,
	"unlocked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_achievements_user_id_achievement_id_pk" PRIMARY KEY("user_id","achievement_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_normalized" CHECK (username = lower(username))
);
--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turns" ADD CONSTRAINT "turns_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_achievement_id_achievements_id_fk" FOREIGN KEY ("achievement_id") REFERENCES "public"."achievements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "achievements_key_unique" ON "achievements" USING btree ("key");--> statement-breakpoint
CREATE INDEX "characters_user_id_idx" ON "characters" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "runs_user_id_idx" ON "runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "runs_character_id_idx" ON "runs" USING btree ("character_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_one_active_per_character" ON "runs" USING btree ("character_id") WHERE status = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "turns_run_id_idx" ON "turns" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "turns_run_sequence_action_key_unique" ON "turns" USING btree ("run_id","sequence","action_key");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_unique" ON "users" USING btree ("username");--> statement-breakpoint
INSERT INTO "monsters" ("id", "name", "tier", "hp", "defense", "temperament", "description", "debauched_description", "enabled") VALUES
	('10000000-0000-4000-8000-000000000001', 'Saltbound Penitent', 2, 14, 11, 'Patient, ritualistic', '', '', true),
	('10000000-0000-4000-8000-000000000002', 'Gutter Drake', 3, 22, 13, 'Hungry, territorial', '', '', true)
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "traps" ("id", "name", "tier", "target", "skill", "consequence", "description", "enabled") VALUES
	('10000000-0000-4000-8000-000000000101', 'Tongueless Bell', 2, 10, 'Knowledge', 'Awakens the wax congregation', '', true),
	('10000000-0000-4000-8000-000000000102', 'Cinder Thread', 1, 8, 'Stealth', 'Burns 1d6 vitality', '', true)
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "achievements" ("id", "key", "name", "description") VALUES
	('10000000-0000-4000-8000-000000000201', 'first-entry', 'First Steps', 'Enter the dungeon for the first time.'),
	('10000000-0000-4000-8000-000000000202', 'first-defeat', 'First Fall', 'Fall to the dungeon for the first time.'),
	('10000000-0000-4000-8000-000000000203', 'double-digits', 'Double Digits', 'Reach room number 10 or beyond.'),
	('10000000-0000-4000-8000-000000000204', 'gold-100', 'Pocket of Gold', 'Accumulate 100 gold.'),
	('10000000-0000-4000-8000-000000000205', 'gold-1000', 'A King''s Ransom', 'Accumulate 1000 gold.')
ON CONFLICT ("id") DO NOTHING;
