/**
 * Коды ошибок — контракт между сервером и клиентом. Фронт переводит код в текст
 * тоста и решает, показывать ли кнопку «Повторить».
 */
export const ERROR_CODES = [
  'unauthorized',
  'forbidden',
  'not_found',
  'validation_failed',
  'conflict_version',
  'duplicate_dupr_id',
  'dupr_id_already_claimed',
  'bootstrap_code_invalid',
  'invite_invalid',
  'tournament_wrong_status',
  'already_in_parallel_tournament',
  'not_all_confirmed',
  'not_enough_players',
  'schedule_impossible',
  'round_not_finished',
  'match_wrong_status',
  'score_required',
  'rate_limited',
  'internal',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    /** Человекочитаемое сообщение на случай, если у клиента нет перевода кода. */
    message: string;
    /** Можно ли осмысленно повторить то же самое действие. */
    retryable: boolean;
    details?: Record<string, unknown>;
  };
}

const RETRYABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'conflict_version',
  'rate_limited',
  'internal',
]);

export function isRetryableErrorCode(code: ErrorCode): boolean {
  return RETRYABLE.has(code);
}

export const HTTP_STATUS_BY_ERROR: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 422,
  conflict_version: 409,
  duplicate_dupr_id: 409,
  dupr_id_already_claimed: 409,
  bootstrap_code_invalid: 403,
  invite_invalid: 410,
  tournament_wrong_status: 409,
  already_in_parallel_tournament: 409,
  not_all_confirmed: 409,
  not_enough_players: 409,
  schedule_impossible: 422,
  round_not_finished: 409,
  match_wrong_status: 409,
  score_required: 409,
  rate_limited: 429,
  internal: 500,
};
