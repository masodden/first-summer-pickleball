-- Организатор: тренировки без доступа к турнирам.
ALTER TYPE "role" ADD VALUE IF NOT EXISTS 'organizer';
