/**
 * Версия приложения. Показывается в настройках, чтобы по скриншоту от игрока
 * было понятно, какая сборка у него на телефоне. Поднимать при релизе вместе с
 * `version` в package.json.
 */
export const APP_VERSION = '0.1.0';

/** Контакт для обратной связи: сюда игроки пишут про баги. */
export const FEEDBACK_TELEGRAM = 'masodden';

/**
 * Как подписан корт на площадке.
 *
 * В клубе корты почти никогда не нумеруются с единицы: вечер занимает корты
 * 4, 5 и 6, а иногда у них и вовсе есть названия. Позиция корта при этом
 * остаётся позицией: в mexicano первый корт — главный, независимо от подписи.
 */
export function courtLabel(court: number, names?: readonly string[] | null): string {
  const name = names?.[court - 1]?.trim();
  return name ? name : String(court);
}

/**
 * Приводит введённые названия к тому, что можно хранить: по одному значению на
 * корт, лишние отбрасываются, недостающие добавляются пустыми. Если не подписан
 * ни один корт, названий нет вовсе — нумеруем от единицы.
 */
export function normalizeCourtNames(
  names: readonly (string | null | undefined)[] | null | undefined,
  courts: number,
): string[] | null {
  if (!names) return null;
  const trimmed = Array.from({ length: courts }, (_, index) => (names[index] ?? '').trim());
  return trimmed.some((name) => name.length > 0) ? trimmed : null;
}

/** Роли. `spectator` не хранится в базе: это просто отсутствие аккаунта. */
export const ROLES = ['admin', 'moderator', 'user'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_WEIGHT: Record<Role, number> = { user: 0, moderator: 1, admin: 2 };

export const TOURNAMENT_FORMATS = ['americano', 'mexicano'] as const;
export type TournamentFormat = (typeof TOURNAMENT_FORMATS)[number];

export const TOURNAMENT_STATUSES = [
  'registration',
  'registration_closed',
  'running',
  'finished',
] as const;
export type TournamentStatus = (typeof TOURNAMENT_STATUSES)[number];

export const MATCH_STATUSES = ['scheduled', 'running', 'paused', 'finished', 'skipped'] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

/** Раунд закрыт: можно стартовать следующий. */
export function isMatchClosed(status: MatchStatus): boolean {
  return status === 'finished' || status === 'skipped';
}

/** Что делать, если таймер вышел при равном счёте. */
export const TIE_RULES = ['draw', 'golden_point'] as const;
export type TieRule = (typeof TIE_RULES)[number];

export const STANDINGS_SORT_KEYS = [
  'points',
  'wins',
  'draws',
  'diff',
  'losses',
  'played',
  'pointsAgainst',
] as const;
export type StandingsSortKey = (typeof STANDINGS_SORT_KEYS)[number];

/** Откуда взялось значение рейтинга DUPR. К API DUPR приложение не обращается. */
export const RATING_SOURCES = ['import', 'moderator', 'self'] as const;
export type RatingSource = (typeof RATING_SOURCES)[number];

export const PARTICIPANT_STATUSES = ['registered', 'waitlisted', 'withdrawn'] as const;
export type ParticipantStatus = (typeof PARTICIPANT_STATUSES)[number];

export const CLAIM_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/**
 * Администраторы клуба по умолчанию: при привязке этих DUPR ID в проде
 * нужен BOOTSTRAP_ADMIN_CODE. Понизить их нельзя; остальных админов — можно.
 */
export const BOOTSTRAP_ADMIN_DUPR_IDS = ['PZQZKM', 'P5ML0M'] as const;

/** DUPR ID — шесть символов из заглавных латинских букв и цифр. */
export const DUPR_ID_PATTERN = /^[A-Z0-9]{6}$/;

export const RATING_MIN = 2;
export const RATING_MAX = 8;
/** Через сколько дней чип рейтинга считается устаревшим и приглушается. */
export const RATING_STALE_AFTER_DAYS = 60;

export const SUPPORTED_LOCALES = ['ru', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'ru';

export function isRoleAtLeast(role: Role | null | undefined, required: Role): boolean {
  if (!role) return false;
  return ROLE_WEIGHT[role] >= ROLE_WEIGHT[required];
}

export function normalizeDuprId(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidDuprId(raw: string): boolean {
  return DUPR_ID_PATTERN.test(normalizeDuprId(raw));
}

export function isBootstrapAdminDupr(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return (BOOTSTRAP_ADMIN_DUPR_IDS as readonly string[]).includes(normalizeDuprId(raw));
}

/** Итоговый статус матча зависит от счёта, а он вводится вручную после игры. */
export function isTerminalTournamentStatus(status: TournamentStatus): boolean {
  return status === 'finished';
}
