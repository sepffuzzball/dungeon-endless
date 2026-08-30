ALTER TYPE "public"."run_phase" ADD VALUE 'awaiting_loot' BEFORE 'awaiting_proceed';--> statement-breakpoint
ALTER TYPE "public"."run_phase" ADD VALUE 'awaiting_failure' BEFORE 'awaiting_proceed';--> statement-breakpoint
DO $$
DECLARE
	duplicate_groups bigint;
BEGIN
	SELECT count(*) INTO duplicate_groups
	FROM (
		SELECT "run_id", "action_key"
		FROM "turns"
		GROUP BY "run_id", "action_key"
		HAVING count(*) > 1
	) duplicates;

	IF duplicate_groups > 0 THEN
		RAISE EXCEPTION 'Cannot create turns_run_id_action_key_unique: found % duplicate (run_id, action_key) group(s). Resolve duplicates explicitly before rerunning migration 0005; no rows were deleted.', duplicate_groups;
	END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "turns_run_id_action_key_unique" ON "turns" USING btree ("run_id","action_key");
