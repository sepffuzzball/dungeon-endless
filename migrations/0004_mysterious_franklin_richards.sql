CREATE TYPE "public"."run_phase" AS ENUM('ready', 'awaiting_proceed');--> statement-breakpoint
ALTER TABLE "room_entries" ADD COLUMN "command_key" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "phase" "run_phase" DEFAULT 'ready' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "room_entries_run_id_command_key_unique" ON "room_entries" USING btree ("run_id","command_key");