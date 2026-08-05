-- Посев площадок до этой версии добавлял «ВДНХ» при каждом запуске API.
-- Оставляем самую раннюю запись каждого названия, остальные удаляем: турниры
-- хранят название площадки текстом, поэтому ссылки не ломаются.
DELETE FROM "venues" WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", row_number() OVER (PARTITION BY "name" ORDER BY "created_at", "id") AS "position"
    FROM "venues"
  ) AS "ranked" WHERE "position" > 1
);
--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_name_unique" UNIQUE("name");
