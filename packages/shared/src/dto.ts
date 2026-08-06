import type {
  ClaimStatus,
  Locale,
  MatchStatus,
  ParticipantStatus,
  RatingSource,
  Role,
  StandingsSortKey,
  TieRule,
  TournamentFormat,
  TournamentStatus,
  TrainingStatus,
} from './domain.js';

/**
 * Игрок. Ключ — DUPR ID, поэтому у настоящих игроков `id === duprId`.
 * Гости без DUPR ID живут в том же пространстве ключей с префиксом `G-`,
 * их можно позже слить с настоящей карточкой.
 */
export interface PlayerDto {
  id: string;
  duprId: string | null;
  firstName: string;
  lastName: string;
  fullName: string;
  doublesRating: number | null;
  singlesRating: number | null;
  ratingUpdatedAt: string | null;
  ratingSource: RatingSource | null;
  /** Рейтинг давно не обновляли — чип показывается приглушённым. */
  ratingStale: boolean;
  /** В свежем импорте значение отличается от текущего; ждёт решения модератора. */
  pendingImportRating: number | null;
  avatarUrl: string | null;
  telegramUsername: string | null;
  /** Роль в клубе на этой карточке (DUPR), не на Telegram-аккаунте. */
  clubRole: Role;
  isGuest: boolean;
  isClaimed: boolean;
  createdAt: string;
}

export interface PlayerRatingHistoryEntryDto {
  id: string;
  previousRating: number | null;
  rating: number | null;
  source: RatingSource;
  changedByName: string | null;
  createdAt: string;
}

export interface PlayerStatsDto {
  tournamentsPlayed: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  pointsFor: number;
  pointsAgainst: number;
  gold: number;
  silver: number;
  bronze: number;
}

export interface PlayerProfileDto {
  player: PlayerDto;
  stats: PlayerStatsDto;
  ratingHistory: PlayerRatingHistoryEntryDto[];
  /** Можно ли текущему пользователю править этого игрока. */
  canEdit: boolean;
  /** Показывать ли DUPR ID: только владельцу профиля и организаторам. */
  canSeeDuprId: boolean;
  /** Один из двух зашитых админов клуба — роль снять нельзя. */
  isBootstrapAdmin: boolean;
  /** Текущий админ может менять clubRole на этой карточке. */
  canManageRole: boolean;
}

export interface ParticipantDto {
  id: string;
  player: PlayerDto;
  status: ParticipantStatus;
  confirmedAndPaid: boolean;
  waitlistPosition: number | null;
  addedBySelf: boolean;
  createdAt: string;
}

export interface TournamentSummaryDto {
  id: string;
  /** Короткий код для публичной ссылки на табло. */
  publicSlug: string;
  title: string;
  category: string | null;
  format: TournamentFormat;
  status: TournamentStatus;
  startsAt: string;
  venueName: string | null;
  courts: number;
  /** Названия кортов по порядку; null — нумерация от 1. */
  courtNames: string[] | null;
  maxPlayers: number;
  participantCount: number;
  confirmedCount: number;
  /** null означает «играем, пока не остановят». */
  roundsPlanned: number | null;
  tieRule: TieRule;
  createdAt: string;
}

export interface TournamentDto extends TournamentSummaryDto {
  description: string | null;
  formatDescription: string | null;
  venueAddress: string | null;
  venueMapUrl: string | null;
  pointsToWin: number;
  matchDurationMin: number | null;
  standingsSort: StandingsSortKey[];
  ratingBalance: boolean;
  entryFee: number | null;
  roundsGenerated: number;
  updatedAt: string;
  /** Права текущего пользователя на этот турнир. */
  canManage: boolean;
  canDelete: boolean;
  myParticipation: ParticipantDto | null;
}

export interface MatchTeamDto {
  players: PlayerDto[];
  score: number | null;
}

export interface MatchDto {
  id: string;
  roundIndex: number;
  /** Позиция корта, начиная с 1: в mexicano это ещё и уровень игры. */
  court: number;
  /** Как корт подписан на площадке: номер или название. */
  courtName: string;
  status: MatchStatus;
  teamA: MatchTeamDto;
  teamB: MatchTeamDto;
  startedAt: string | null;
  pausedAt: string | null;
  pausedTotalMs: number;
  finishedAt: string | null;
  /** Полная длительность матча в миллисекундах, если турнир играется по таймеру. */
  durationMs: number | null;
  version: number;
}

export interface RoundDto {
  index: number;
  matches: MatchDto[];
  sittingOut: PlayerDto[];
  allFinished: boolean;
  allScored: boolean;
  /** Все матчи пропущены. */
  skipped: boolean;
  /** Раунд закрыт (finished или skipped) — можно начинать следующий. */
  closed: boolean;
}

export interface StandingRowDto {
  rank: number;
  player: PlayerDto;
  played: number;
  wins: number;
  losses: number;
  draws: number;
  pointsFor: number;
  pointsAgainst: number;
  diff: number;
  medal: 'gold' | 'silver' | 'bronze' | null;
}

export interface TournamentStateDto {
  tournament: TournamentDto;
  participants: ParticipantDto[];
  rounds: RoundDto[];
  standings: StandingRowDto[];
}

export interface SessionDto {
  accountId: string;
  role: Role;
  locale: Locale;
  notificationsEnabled: boolean;
  reducedMotion: boolean;
  telegramUsername: string | null;
  player: PlayerDto | null;
  claim: { duprId: string; status: ClaimStatus } | null;
  /** Аккаунт заявил админский DUPR ID и ждёт ввода bootstrap-кода. */
  needsBootstrapCode: boolean;
}

export interface AuthResponseDto {
  token: string;
  session: SessionDto;
}

export interface ClaimRequestDto {
  id: string;
  player: PlayerDto;
  telegramUsername: string | null;
  telegramName: string;
  status: ClaimStatus;
  createdAt: string;
}

export interface InviteDto {
  token: string;
  url: string;
  player: PlayerDto;
  expiresAt: string;
}

export interface VenueDto {
  id: string;
  name: string;
  address: string | null;
  mapUrl: string | null;
}

export interface ImportReportDto {
  created: number;
  updated: number;
  conflicts: number;
  skipped: number;
  total: number;
}

export interface PaginatedDto<T> {
  items: T[];
  total: number;
}

export interface TrainingCourtBlockDto {
  sortIndex: number;
  courts: number;
  hours: number;
}

export interface TrainingParticipantDto {
  id: string;
  player: PlayerDto;
  status: ParticipantStatus;
  confirmedAndPaid: boolean;
  waitlistPosition: number | null;
  addedBySelf: boolean;
  /** Ручная сумма; null — использовать suggestedAmount. */
  amountDue: number | null;
  /** Автодоля: totalCost / число записавшихся. */
  suggestedAmount: number;
  /** Итоговая сумма к показу (ручная или suggested). */
  amount: number;
  createdAt: string;
}

export interface TrainingSummaryDto {
  id: string;
  title: string;
  status: TrainingStatus;
  startsAt: string;
  venueName: string | null;
  maxPlayers: number | null;
  pricePerCourtHour: number;
  courtHours: number;
  totalCost: number;
  participantCount: number;
  confirmedCount: number;
  courtBlocks: TrainingCourtBlockDto[];
  createdAt: string;
}

export interface TrainingDto extends TrainingSummaryDto {
  description: string | null;
  venueAddress: string | null;
  venueMapUrl: string | null;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  canManage: boolean;
  canDelete: boolean;
  /** Все registered подтверждены и есть хотя бы один — можно стартовать / показывать суммы. */
  allConfirmed: boolean;
  myParticipation: TrainingParticipantDto | null;
}

export interface TrainingStateDto {
  training: TrainingDto;
  participants: TrainingParticipantDto[];
}
