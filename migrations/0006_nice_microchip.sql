ALTER TABLE "characters" ADD COLUMN "pronouns" text DEFAULT 'he/him/his' NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "gender_identity" text DEFAULT 'male' NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_pronouns_length" CHECK (char_length(btrim("characters"."pronouns")) between 1 and 80
				and btrim("characters"."pronouns") !~ '[[:cntrl:]]');--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_gender_identity_length" CHECK (char_length(btrim("characters"."gender_identity")) between 1 and 80
				and btrim("characters"."gender_identity") !~ '[[:cntrl:]]');