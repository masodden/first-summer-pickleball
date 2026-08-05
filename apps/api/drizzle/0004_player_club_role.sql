-- Роль клуба на карточке игрока (DUPR), не на Telegram-аккаунте.
ALTER TABLE "players" ADD COLUMN "club_role" "role" DEFAULT 'user' NOT NULL;--> statement-breakpoint
CREATE INDEX "players_club_role_idx" ON "players" USING btree ("club_role");--> statement-breakpoint
-- Переносим уже выданные роли с привязанных аккаунтов.
UPDATE "players" AS p
SET "club_role" = a."role"
FROM "accounts" AS a
WHERE a."player_id" = p."id"
  AND a."role" IN ('admin', 'moderator');--> statement-breakpoint
UPDATE "players"
SET "club_role" = 'admin'
WHERE "dupr_id" IN ('PZQZKM', 'P5ML0M');
