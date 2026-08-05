import type { ZodType } from 'zod';
import { ApiError } from './errors.js';

/** Разбирает тело запроса и превращает ошибки zod в понятный ответ API. */
export function parse<T>(schema: ZodType<T>, payload: unknown): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      fields[issue.path.join('.') || '_'] = issue.message;
    }
    throw new ApiError('validation_failed', 'Проверьте заполненные поля', { fields });
  }
  return result.data;
}
