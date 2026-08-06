CREATE TYPE "public"."training_status" AS ENUM('registration', 'running', 'finished');--> statement-breakpoint
CREATE TABLE "trainings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"status" "training_status" DEFAULT 'registration' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"max_players" integer,
	"price_per_court_hour" integer NOT NULL,
	"description" text,
	"venue_name" text,
	"venue_address" text,
	"venue_map_url" text,
	"created_by_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "training_court_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"training_id" uuid NOT NULL,
	"sort_index" integer NOT NULL,
	"courts" integer NOT NULL,
	"hours" numeric(4, 1) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_court_blocks_unique" UNIQUE("training_id","sort_index")
);
--> statement-breakpoint
CREATE TABLE "training_players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"training_id" uuid NOT NULL,
	"player_id" text NOT NULL,
	"status" "participant_status" DEFAULT 'registered' NOT NULL,
	"confirmed_and_paid" boolean DEFAULT false NOT NULL,
	"amount_due" integer,
	"waitlist_position" integer,
	"added_by_self" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_players_unique" UNIQUE("training_id","player_id")
);
--> statement-breakpoint
ALTER TABLE "trainings" ADD CONSTRAINT "trainings_created_by_account_id_accounts_id_fk" FOREIGN KEY ("created_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_court_blocks" ADD CONSTRAINT "training_court_blocks_training_id_trainings_id_fk" FOREIGN KEY ("training_id") REFERENCES "public"."trainings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_players" ADD CONSTRAINT "training_players_training_id_trainings_id_fk" FOREIGN KEY ("training_id") REFERENCES "public"."trainings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_players" ADD CONSTRAINT "training_players_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trainings_status_idx" ON "trainings" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "training_court_blocks_training_idx" ON "training_court_blocks" USING btree ("training_id");--> statement-breakpoint
CREATE INDEX "training_players_training_idx" ON "training_players" USING btree ("training_id");
