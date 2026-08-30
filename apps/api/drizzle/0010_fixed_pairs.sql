ALTER TYPE "public"."tournament_format" ADD VALUE IF NOT EXISTS 'fixed_pairs';
--> statement-breakpoint
ALTER TABLE "tournament_players" ADD COLUMN IF NOT EXISTS "partner_player_id" text;
--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN IF NOT EXISTS "bracket_config" jsonb;
--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "games" jsonb;
--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "stage" text;
--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "group_index" integer;
--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "bracket_slot" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "tournament_players"
    ADD CONSTRAINT "tournament_players_partner_player_id_players_id_fk"
    FOREIGN KEY ("partner_player_id") REFERENCES "public"."players"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
