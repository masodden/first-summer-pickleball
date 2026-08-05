import {
  HTTP_STATUS_BY_ERROR,
  isRetryableErrorCode,
  type ApiErrorBody,
  type ErrorCode,
} from '@fsp/shared';

/**
 * Единственный способ вернуть ошибку клиенту. Код ошибки — часть контракта:
 * фронт по нему подбирает текст тоста и решает, показывать ли «Повторить».
 */
export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message ?? code);
    this.name = 'ApiError';
  }

  get statusCode(): number {
    return HTTP_STATUS_BY_ERROR[this.code];
  }

  toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        retryable: isRetryableErrorCode(this.code),
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export const unauthorized = (message = 'Нужно войти в приложение'): ApiError =>
  new ApiError('unauthorized', message);

export const forbidden = (message = 'Недостаточно прав'): ApiError =>
  new ApiError('forbidden', message);

export const notFound = (message = 'Не найдено'): ApiError => new ApiError('not_found', message);

export const conflictVersion = (details?: Record<string, unknown>): ApiError =>
  new ApiError('conflict_version', 'Данные изменились с другого устройства', details);

export const wrongStatus = (message: string): ApiError =>
  new ApiError('tournament_wrong_status', message);
