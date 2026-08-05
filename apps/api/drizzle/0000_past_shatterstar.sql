CREATE TYPE "public"."claim_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."field_source" AS ENUM('import', 'manual', 'self');--> statement-breakpoint
CREATE TYPE "public"."locale" AS ENUM('ru', 'en');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('scheduled', 'running', 'paused', 'finished');--> statement-breakpoint
CREATE TYPE "public"."participant_status" AS ENUM('registered', 'waitlisted', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."rating_source" AS ENUM('import', 'moderator', 'self');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('admin', 'moderator', 'user');--> statement-breakpoint
CREATE TYPE "public"."team_side" AS ENUM('A', 'B');--> statement-breakpoint
CREATE TYPE "public"."tie_rule" AS ENUM('draw', 'golden_point');--> statement-breakpoint
CREATE TYPE "public"."tournament_format" AS ENUM('americano', 'mexicano');--> statement-breakpoint
CREATE TYPE "public"."tournament_status" AS ENUM('registration', 'registration_closed', 'running', 'finished');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_id" text NOT NULL,
	"telegram_username" text,
	"telegram_first_name" text,
	"telegram_last_name" text,
	"telegram_photo_url" text,
	"role" "role" DEFAULT 'user' NOT NULL,
	"locale" "locale" DEFAULT 'ru' NOT NULL,
	"player_id" text,
	"notifications_enabled" boolean DEFAULT true NOT NULL,
	"reduced_motion" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"actor_name" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"tournament_id" uuid,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"player_id" text NOT NULL,
	"status" "claim_status" DEFAULT 'pending' NOT NULL,
	"decided_by_account_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"token" text PRIMARY KEY NOT NULL,
	"player_id" text NOT NULL,
	"created_by_account_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"used_by_account_id" uuid,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"player_id" text NOT NULL,
	"team" "team_side" NOT NULL,
	"slot" integer NOT NULL,
	CONSTRAINT "match_players_unique" UNIQUE("match_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"round_index" integer NOT NULL,
	"court" integer NOT NULL,
	"status" "match_status" DEFAULT 'scheduled' NOT NULL,
	"score_a" integer,
	"score_b" integer,
	"started_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"paused_total_ms" integer DEFAULT 0 NOT NULL,
	"finished_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matches_court_unique" UNIQUE("round_id","court")
);
--> statement-breakpoint
CREATE TABLE "player_rating_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" text NOT NULL,
	"previous_rating" numeric(4, 3),
	"rating" numeric(4, 3),
	"source" "rating_source" NOT NULL,
	"changed_by_account_id" uuid,
	"changed_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" text PRIMARY KEY NOT NULL,
	"dupr_id" text,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"doubles_rating" numeric(4, 3),
	"singles_rating" numeric(4, 3),
	"rating_updated_at" timestamp with time zone,
	"rating_source" "rating_source",
	"pending_import_rating" numeric(4, 3),
	"avatar_url" text,
	"telegram_username" text,
	"is_guest" boolean DEFAULT false NOT NULL,
	"name_source" "field_source" DEFAULT 'import' NOT NULL,
	"avatar_source" "field_source",
	"merged_into_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "round_sitouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"player_id" text NOT NULL,
	CONSTRAINT "round_sitouts_unique" UNIQUE("round_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rounds_unique" UNIQUE("tournament_id","index")
);
--> statement-breakpoint
CREATE TABLE "tournament_players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"player_id" text NOT NULL,
	"status" "participant_status" DEFAULT 'registered' NOT NULL,
	"confirmed_and_paid" boolean DEFAULT false NOT NULL,
	"waitlist_position" integer,
	"added_by_self" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournament_players_unique" UNIQUE("tournament_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "tournaments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"category" text,
	"format" "tournament_format" NOT NULL,
	"status" "tournament_status" DEFAULT 'registration' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"courts" integer NOT NULL,
	"max_players" integer NOT NULL,
	"points_to_win" integer DEFAULT 11 NOT NULL,
	"match_duration_min" integer,
	"rounds_planned" integer,
	"tie_rule" "tie_rule" DEFAULT 'draw' NOT NULL,
	"standings_sort" jsonb DEFAULT '["wins","points","diff"]'::jsonb NOT NULL,
	"rating_balance" boolean DEFAULT true NOT NULL,
	"entry_fee" integer,
	"description" text,
	"format_description" text,
	"venue_name" text,
	"venue_address" text,
	"venue_map_url" text,
	"schedule_seed" integer DEFAULT 1 NOT NULL,
	"public_slug" text NOT NULL,
	"created_by_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"map_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_decided_by_account_id_accounts_id_fk" FOREIGN KEY ("decided_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_account_id_accounts_id_fk" FOREIGN KEY ("created_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_used_by_account_id_accounts_id_fk" FOREIGN KEY ("used_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_rating_history" ADD CONSTRAINT "player_rating_history_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_rating_history" ADD CONSTRAINT "player_rating_history_changed_by_account_id_accounts_id_fk" FOREIGN KEY ("changed_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_sitouts" ADD CONSTRAINT "round_sitouts_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_sitouts" ADD CONSTRAINT "round_sitouts_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_players" ADD CONSTRAINT "tournament_players_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_players" ADD CONSTRAINT "tournament_players_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_created_by_account_id_accounts_id_fk" FOREIGN KEY ("created_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_telegram_id_key" ON "accounts" USING btree ("telegram_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_player_id_key" ON "accounts" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_tournament_idx" ON "audit_log" USING btree ("tournament_id");--> statement-breakpoint
CREATE INDEX "claims_status_idx" ON "claims" USING btree ("status");--> statement-breakpoint
CREATE INDEX "claims_account_idx" ON "claims" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "invites_player_idx" ON "invites" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "match_players_match_idx" ON "match_players" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "match_players_player_idx" ON "match_players" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "matches_tournament_idx" ON "matches" USING btree ("tournament_id","round_index");--> statement-breakpoint
CREATE INDEX "rating_history_player_idx" ON "player_rating_history" USING btree ("player_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "players_dupr_id_key" ON "players" USING btree ("dupr_id");--> statement-breakpoint
CREATE INDEX "players_last_name_idx" ON "players" USING btree ("last_name");--> statement-breakpoint
CREATE INDEX "tournament_players_tournament_idx" ON "tournament_players" USING btree ("tournament_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tournaments_public_slug_key" ON "tournaments" USING btree ("public_slug");--> statement-breakpoint
CREATE INDEX "tournaments_status_idx" ON "tournaments" USING btree ("status","starts_at");