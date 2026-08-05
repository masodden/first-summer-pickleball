import { z } from 'zod';
import {
  DUPR_ID_PATTERN,
  RATING_MAX,
  RATING_MIN,
  STANDINGS_SORT_KEYS,
  SUPPORTED_LOCALES,
  TIE_RULES,
  TOURNAMENT_FORMATS,
} from './domain.js';

export const duprIdSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine((value) => DUPR_ID_PATTERN.test(value), {
    message: 'DUPR ID состоит из шести символов: заглавные латинские буквы и цифры',
  });

/** Рейтинг DUPR или явное «нет рейтинга» для новичков. */
export const ratingSchema = z.number().min(RATING_MIN).max(RATING_MAX).multipleOf(0.001).nullable();

export const localeSchema = z.enum(SUPPORTED_LOCALES);

export const telegramAuthSchema = z.object({
  initData: z.string().min(1),
});

export const claimSchema = z.object({
  duprId: duprIdSchema,
  firstName: z.string().trim().min(1).max(60).optional(),
  lastName: z.string().trim().min(1).max(60).optional(),
  doublesRating: ratingSchema.optional(),
  /** Требуется только для зашитых администраторов клуба. */
  code: z.string().trim().min(1).max(128).optional(),
});

export const bootstrapSchema = z.object({
  code: z.string().trim().min(1).max(128),
});

export const updateSettingsSchema = z.object({
  locale: localeSchema.optional(),
  firstName: z.string().trim().min(1).max(60).optional(),
  lastName: z.string().trim().min(1).max(60).optional(),
  avatarUrl: z.string().url().max(500).nullable().optional(),
});

export const createPlayerSchema = z.object({
  duprId: duprIdSchema.nullable().optional(),
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  doublesRating: ratingSchema.optional(),
  singlesRating: ratingSchema.optional(),
});

export const updatePlayerSchema = z.object({
  firstName: z.string().trim().min(1).max(60).optional(),
  lastName: z.string().trim().min(1).max(60).optional(),
  doublesRating: ratingSchema.optional(),
  singlesRating: ratingSchema.optional(),
  avatarUrl: z.string().url().max(500).nullable().optional(),
  telegramUsername: z.string().trim().max(64).nullable().optional(),
});

export const updateRatingSchema = z.object({
  doublesRating: ratingSchema,
});

export const mergeGuestSchema = z.object({
  duprId: duprIdSchema,
});

export const standingsSortSchema = z.array(z.enum(STANDINGS_SORT_KEYS)).min(1).max(7);

/**
 * Названия кортов по порядку. Пустые значения допускаются: организатор мог
 * подписать только часть кортов, остальные останутся под своими номерами.
 */
export const courtNamesSchema = z.array(z.string().trim().max(24)).max(20).nullable().optional();

export const createTournamentSchema = z.object({
  title: z.string().trim().min(2).max(120),
  category: z.string().trim().max(60).nullable().optional(),
  format: z.enum(TOURNAMENT_FORMATS),
  startsAt: z.string().datetime({ offset: true }),
  courts: z.number().int().min(1).max(20),
  courtNames: courtNamesSchema,
  maxPlayers: z.number().int().min(4).max(200),
  pointsToWin: z.number().int().min(1).max(99),
  matchDurationMin: z.number().int().min(1).max(180).nullable().optional(),
  /** null — играем, пока организатор не остановит турнир. */
  roundsPlanned: z.number().int().min(1).max(60).nullable().optional(),
  tieRule: z.enum(TIE_RULES).optional(),
  standingsSort: standingsSortSchema.optional(),
  ratingBalance: z.boolean().optional(),
  entryFee: z.number().int().min(0).max(1_000_000).nullable().optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  formatDescription: z.string().trim().max(4000).nullable().optional(),
  venueName: z.string().trim().max(160).nullable().optional(),
  venueAddress: z.string().trim().max(400).nullable().optional(),
  venueMapUrl: z.string().url().max(500).nullable().optional(),
});

export const updateTournamentSchema = createTournamentSchema.partial();

export const addParticipantSchema = z.object({
  playerId: z.string().trim().min(1).max(64),
});

export const setPaidSchema = z.object({
  confirmedAndPaid: z.boolean(),
});

export const generateScheduleSchema = z.object({
  /** Обязателен для americano; для mexicano раунды создаются по мере игры. */
  rounds: z.number().int().min(1).max(60).optional(),
  seed: z.number().int().optional(),
});

export const reshuffleSchema = z.object({
  seed: z.number().int().optional(),
});

export const matchScoreSchema = z.object({
  scoreA: z.number().int().min(0).max(200),
  scoreB: z.number().int().min(0).max(200),
  /** Оптимистичная блокировка: сервер отклонит устаревшую версию. */
  version: z.number().int().min(0),
});

export const matchActionSchema = z.object({
  version: z.number().int().min(0),
});

/** Роль клуба на карточке игрока (DUPR). Зашитых админов понизить нельзя. */
export const setRoleSchema = z.object({
  role: z.enum(['admin', 'moderator', 'user']),
});

export const importPlayersSchema = z.object({
  /** CSV или JSON выгрузка справочника DUPR. */
  content: z.string().min(1).max(20_000_000),
  format: z.enum(['csv', 'json']).optional(),
});

export type TelegramAuthInput = z.infer<typeof telegramAuthSchema>;
export type ClaimInput = z.infer<typeof claimSchema>;
export type CreatePlayerInput = z.infer<typeof createPlayerSchema>;
export type UpdatePlayerInput = z.infer<typeof updatePlayerSchema>;
export type CreateTournamentInput = z.infer<typeof createTournamentSchema>;
export type UpdateTournamentInput = z.infer<typeof updateTournamentSchema>;
export type MatchScoreInput = z.infer<typeof matchScoreSchema>;
export type ImportPlayersInput = z.infer<typeof importPlayersSchema>;
