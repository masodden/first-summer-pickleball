import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['admin', 'moderator', 'organizer', 'user']);
export const localeEnum = pgEnum('locale', ['ru', 'en']);
export const ratingSourceEnum = pgEnum('rating_source', ['import', 'moderator', 'self']);
export const claimStatusEnum = pgEnum('claim_status', ['pending', 'approved', 'rejected']);
export const tournamentFormatEnum = pgEnum('tournament_format', ['americano', 'mexicano']);
export const tournamentStatusEnum = pgEnum('tournament_status', [
  'registration',
  'registration_closed',
  'running',
  'finished',
  'archived',
]);
export const tieRuleEnum = pgEnum('tie_rule', ['draw', 'golden_point']);
export const participantStatusEnum = pgEnum('participant_status', [
  'registered',
  'waitlisted',
  'withdrawn',
]);
export const matchStatusEnum = pgEnum('match_status', [
  'scheduled',
  'running',
  'paused',
  'finished',
  'skipped',
]);
export const teamSideEnum = pgEnum('team_side', ['A', 'B']);
/** Откуда взялось значение поля: нужно, чтобы импорт не перетирал ручные правки. */
export const fieldSourceEnum = pgEnum('field_source', ['import', 'manual', 'self']);
/** Тренировки: сразу активны (`running`), затем `finished`. `registration` — наследие. */
export const trainingStatusEnum = pgEnum('training_status', [
  'registration',
  'running',
  'finished',
]);

/**
 * Игроки. Ключ — DUPR ID, поэтому у настоящего игрока `id === dupr_id`.
 * Гости без DUPR ID получают ключ вида `G-xxxxxxxx` в том же пространстве имён,
 * а позже их карточку можно слить с настоящей.
 */
export const players = pgTable(
  'players',
  {
    id: text().primaryKey(),
    duprId: text(),
    firstName: text().notNull(),
    lastName: text().notNull(),
    doublesRating: numeric({ precision: 4, scale: 3, mode: 'number' }),
    singlesRating: numeric({ precision: 4, scale: 3, mode: 'number' }),
    ratingUpdatedAt: timestamp({ withTimezone: true }),
    ratingSource: ratingSourceEnum(),
    /** Значение из свежей выгрузки, которое расходится с ручным. Ждёт решения модератора. */
    pendingImportRating: numeric({ precision: 4, scale: 3, mode: 'number' }),
    avatarUrl: text(),
    telegramUsername: text(),
    /**
     * Роль в клубе привязана к карточке (DUPR ID), а не к Telegram.
     * При входе аккаунт подхватывает это значение.
     */
    clubRole: roleEnum().notNull().default('user'),
    isGuest: boolean().notNull().default(false),
    nameSource: fieldSourceEnum().notNull().default('import'),
    avatarSource: fieldSourceEnum(),
    /** Заполняется, когда карточку гостя слили с настоящей: ссылка на победителя. */
    mergedIntoId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('players_dupr_id_key').on(table.duprId),
    index('players_last_name_idx').on(table.lastName),
    index('players_club_role_idx').on(table.clubRole),
  ],
);

export const accounts = pgTable(
  'accounts',
  {
    id: uuid().primaryKey().defaultRandom(),
    telegramId: text().notNull(),
    telegramUsername: text(),
    telegramFirstName: text(),
    telegramLastName: text(),
    telegramPhotoUrl: text(),
    role: roleEnum().notNull().default('user'),
    locale: localeEnum().notNull().default('ru'),
    playerId: text().references(() => players.id, { onDelete: 'set null' }),
    notificationsEnabled: boolean().notNull().default(true),
    reducedMotion: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('accounts_telegram_id_key').on(table.telegramId),
    uniqueIndex('accounts_player_id_key').on(table.playerId),
  ],
);

/** История рейтинга: видно, кто поставил значение, и можно откатить опечатку. */
export const playerRatingHistory = pgTable(
  'player_rating_history',
  {
    id: uuid().primaryKey().defaultRandom(),
    playerId: text()
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    previousRating: numeric({ precision: 4, scale: 3, mode: 'number' }),
    rating: numeric({ precision: 4, scale: 3, mode: 'number' }),
    source: ratingSourceEnum().notNull(),
    changedByAccountId: uuid().references(() => accounts.id, { onDelete: 'set null' }),
    changedByName: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('rating_history_player_idx').on(table.playerId, table.createdAt)],
);

/** Заявки на привязку DUPR ID к аккаунту Telegram. */
export const claims = pgTable(
  'claims',
  {
    id: uuid().primaryKey().defaultRandom(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    playerId: text()
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    status: claimStatusEnum().notNull().default('pending'),
    decidedByAccountId: uuid().references(() => accounts.id, { onDelete: 'set null' }),
    decidedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('claims_status_idx').on(table.status),
    index('claims_account_idx').on(table.accountId),
  ],
);

/** Одноразовые ссылки-приглашения: привязка без ручного подтверждения. */
export const invites = pgTable(
  'invites',
  {
    token: text().primaryKey(),
    playerId: text()
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    createdByAccountId: uuid().references(() => accounts.id, { onDelete: 'set null' }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    usedByAccountId: uuid().references(() => accounts.id, { onDelete: 'set null' }),
    usedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('invites_player_idx').on(table.playerId)],
);

export const venues = pgTable('venues', {
  id: uuid().primaryKey().defaultRandom(),
  /** Уникально: иначе посев при каждом запуске добавлял бы ещё одну «ВДНХ». */
  name: text().notNull().unique(),
  address: text(),
  mapUrl: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const tournaments = pgTable(
  'tournaments',
  {
    id: uuid().primaryKey().defaultRandom(),
    title: text().notNull(),
    category: text(),
    format: tournamentFormatEnum().notNull(),
    status: tournamentStatusEnum().notNull().default('registration'),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    courts: integer().notNull(),
    /**
     * Как корты называются на площадке: «4», «5», «Центральный».
     * null — нумеруем от 1 до количества кортов.
     */
    courtNames: jsonb().$type<string[]>(),
    maxPlayers: integer().notNull(),
    pointsToWin: integer().notNull().default(11),
    matchDurationMin: integer(),
    /** null — играем, пока организатор не остановит турнир. */
    roundsPlanned: integer(),
    tieRule: tieRuleEnum().notNull().default('draw'),
    standingsSort: jsonb().$type<string[]>().notNull().default(['wins', 'points', 'diff']),
    ratingBalance: boolean().notNull().default(true),
    entryFee: integer(),
    description: text(),
    formatDescription: text(),
    venueName: text(),
    venueAddress: text(),
    venueMapUrl: text(),
    /** Seed расписания: тот же seed воспроизводит те же пары. */
    scheduleSeed: integer().notNull().default(1),
    publicSlug: text().notNull(),
    createdByAccountId: uuid().references(() => accounts.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
    /** Мягкое удаление: история турниров не теряется. */
    deletedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    uniqueIndex('tournaments_public_slug_key').on(table.publicSlug),
    index('tournaments_status_idx').on(table.status, table.startsAt),
  ],
);

export const tournamentPlayers = pgTable(
  'tournament_players',
  {
    id: uuid().primaryKey().defaultRandom(),
    tournamentId: uuid()
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    playerId: text()
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    status: participantStatusEnum().notNull().default('registered'),
    /** Галочка модератора: пришёл и оплатил участие. */
    confirmedAndPaid: boolean().notNull().default(false),
    waitlistPosition: integer(),
    addedBySelf: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('tournament_players_unique').on(table.tournamentId, table.playerId),
    index('tournament_players_tournament_idx').on(table.tournamentId),
  ],
);

export const rounds = pgTable(
  'rounds',
  {
    id: uuid().primaryKey().defaultRandom(),
    tournamentId: uuid()
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    index: integer().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('rounds_unique').on(table.tournamentId, table.index)],
);

export const matches = pgTable(
  'matches',
  {
    id: uuid().primaryKey().defaultRandom(),
    tournamentId: uuid()
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    roundId: uuid()
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    roundIndex: integer().notNull(),
    court: integer().notNull(),
    status: matchStatusEnum().notNull().default('scheduled'),
    scoreA: integer(),
    scoreB: integer(),
    /** Таймер считается на сервере, поэтому все устройства видят одно и то же. */
    startedAt: timestamp({ withTimezone: true }),
    pausedAt: timestamp({ withTimezone: true }),
    pausedTotalMs: integer().notNull().default(0),
    finishedAt: timestamp({ withTimezone: true }),
    /** Оптимистичная блокировка: защищает от молчаливой перезаписи счёта. */
    version: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('matches_court_unique').on(table.roundId, table.court),
    index('matches_tournament_idx').on(table.tournamentId, table.roundIndex),
  ],
);

export const matchPlayers = pgTable(
  'match_players',
  {
    id: uuid().primaryKey().defaultRandom(),
    matchId: uuid()
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    playerId: text()
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    team: teamSideEnum().notNull(),
    slot: integer().notNull(),
  },
  (table) => [
    unique('match_players_unique').on(table.matchId, table.playerId),
    index('match_players_match_idx').on(table.matchId),
    index('match_players_player_idx').on(table.playerId),
  ],
);

/** Кто пропускает раунд, когда игроков больше, чем мест на кортах. */
export const roundSitouts = pgTable(
  'round_sitouts',
  {
    id: uuid().primaryKey().defaultRandom(),
    roundId: uuid()
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    playerId: text()
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
  },
  (table) => [unique('round_sitouts_unique').on(table.roundId, table.playerId)],
);

/**
 * Тренировка клуба: запись по ссылке и учёт оплаты за аренду кортов.
 * Отдельно от турниров — нет расписания, счёта и выгрузки в DUPR.
 */
export const trainings = pgTable(
  'trainings',
  {
    id: uuid().primaryKey().defaultRandom(),
    title: text().notNull(),
    status: trainingStatusEnum().notNull().default('running'),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    /** null — без лимита мест. */
    maxPlayers: integer(),
    /** Стоимость одного корта в час (целые единицы, как entryFee у турнира). */
    pricePerCourtHour: integer().notNull(),
    description: text(),
    venueName: text(),
    venueAddress: text(),
    venueMapUrl: text(),
    createdByAccountId: uuid().references(() => accounts.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (table) => [index('trainings_status_idx').on(table.status, table.startsAt)],
);

/** Блоки аренды: «1 корт × 1 ч» + «2 корта × 2 ч» → 5 корт·часов. */
export const trainingCourtBlocks = pgTable(
  'training_court_blocks',
  {
    id: uuid().primaryKey().defaultRandom(),
    trainingId: uuid()
      .notNull()
      .references(() => trainings.id, { onDelete: 'cascade' }),
    sortIndex: integer().notNull(),
    courts: integer().notNull(),
    /** Часы с шагом 0.5. */
    hours: numeric({ precision: 4, scale: 1, mode: 'number' }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('training_court_blocks_unique').on(table.trainingId, table.sortIndex),
    index('training_court_blocks_training_idx').on(table.trainingId),
  ],
);

export const trainingPlayers = pgTable(
  'training_players',
  {
    id: uuid().primaryKey().defaultRandom(),
    trainingId: uuid()
      .notNull()
      .references(() => trainings.id, { onDelete: 'cascade' }),
    playerId: text()
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    status: participantStatusEnum().notNull().default('registered'),
    confirmedAndPaid: boolean().notNull().default(false),
    /** Ручная сумма; null — делить totalCost на число записавшихся. */
    amountDue: integer(),
    waitlistPosition: integer(),
    addedBySelf: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('training_players_unique').on(table.trainingId, table.playerId),
    index('training_players_training_idx').on(table.trainingId),
  ],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid().primaryKey().defaultRandom(),
    accountId: uuid().references(() => accounts.id, { onDelete: 'set null' }),
    actorName: text(),
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: text(),
    tournamentId: uuid().references(() => tournaments.id, { onDelete: 'cascade' }),
    payload: jsonb().$type<Record<string, unknown>>(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_log_created_idx').on(table.createdAt),
    index('audit_log_tournament_idx').on(table.tournamentId),
  ],
);

/** Служебные значения: дата последнего импорта справочника и подобное. */
export const appMeta = pgTable('app_meta', {
  key: text().primaryKey(),
  value: text().notNull(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export type PlayerRow = typeof players.$inferSelect;
export type AccountRow = typeof accounts.$inferSelect;
export type TournamentRow = typeof tournaments.$inferSelect;
export type TournamentPlayerRow = typeof tournamentPlayers.$inferSelect;
export type MatchRow = typeof matches.$inferSelect;
export type MatchPlayerRow = typeof matchPlayers.$inferSelect;
export type RoundRow = typeof rounds.$inferSelect;
export type ClaimRow = typeof claims.$inferSelect;
export type InviteRow = typeof invites.$inferSelect;
export type RatingHistoryRow = typeof playerRatingHistory.$inferSelect;
export type TrainingRow = typeof trainings.$inferSelect;
export type TrainingCourtBlockRow = typeof trainingCourtBlocks.$inferSelect;
export type TrainingPlayerRow = typeof trainingPlayers.$inferSelect;
