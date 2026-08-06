-- Тренировки больше не стартуют отдельно: активны сразу, как «Идёт».
UPDATE "trainings"
SET
  "status" = 'running',
  "started_at" = COALESCE("started_at", "created_at"),
  "updated_at" = now()
WHERE "status" = 'registration'
  AND "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "trainings" ALTER COLUMN "status" SET DEFAULT 'running';
