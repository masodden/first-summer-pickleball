-- Отложенный конфликт рейтинга больше не нужен: выгрузка всегда перезаписывает.
-- Сначала применяем уже лежащие значения из последней выгрузки.
INSERT INTO "player_rating_history" (
  "player_id",
  "previous_rating",
  "rating",
  "source",
  "changed_by_name"
)
SELECT
  "id",
  "doubles_rating",
  "pending_import_rating",
  'import',
  'Импорт справочника'
FROM "players"
WHERE "pending_import_rating" IS NOT NULL;
--> statement-breakpoint
UPDATE "players"
SET
  "doubles_rating" = "pending_import_rating",
  "rating_updated_at" = now(),
  "rating_source" = 'import',
  "updated_at" = now()
WHERE "pending_import_rating" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "players" DROP COLUMN IF EXISTS "pending_import_rating";
