import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApiError } from '../lib/errors.js';

export interface TelegramInitUser {
  id: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  photoUrl: string | null;
  languageCode: string | null;
}

export interface VerifiedInitData {
  user: TelegramInitUser;
  authDate: Date;
  /** Полезная нагрузка из deep-link, например токен приглашения. */
  startParam: string | null;
}

/**
 * Проверяет подпись initData Telegram Mini App.
 *
 * Telegram подписывает данные ключом, производным от токена бота, поэтому
 * успешная проверка означает, что пользователь действительно тот, кем себя
 * называет. Никаких паролей в приложении не появляется.
 *
 * Порядок действий описан в документации Telegram: собрать пары `key=value`
 * без `hash`, отсортировать, посчитать HMAC-SHA256 с ключом, который сам
 * является HMAC-SHA256 токена бота под константой `WebAppData`.
 */
export function verifyInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 86_400,
): VerifiedInitData {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) {
    throw new ApiError('unauthorized', 'В данных Telegram нет подписи');
  }

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const provided = Buffer.from(hash, 'hex');
  const computed = Buffer.from(expected, 'hex');
  if (provided.length !== computed.length || !timingSafeEqual(provided, computed)) {
    throw new ApiError('unauthorized', 'Подпись Telegram не сходится');
  }

  const authDateRaw = params.get('auth_date');
  const authDateSeconds = authDateRaw ? Number.parseInt(authDateRaw, 10) : Number.NaN;
  if (!Number.isFinite(authDateSeconds)) {
    throw new ApiError('unauthorized', 'В данных Telegram нет времени авторизации');
  }
  const authDate = new Date(authDateSeconds * 1000);
  const ageSeconds = (Date.now() - authDate.getTime()) / 1000;
  // Защита от повторного использования украденных данных.
  if (ageSeconds > maxAgeSeconds) {
    throw new ApiError('unauthorized', 'Данные Telegram устарели, откройте приложение заново');
  }

  const rawUser = params.get('user');
  if (!rawUser) {
    throw new ApiError('unauthorized', 'В данных Telegram нет пользователя');
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawUser) as Record<string, unknown>;
  } catch {
    throw new ApiError('unauthorized', 'Не удалось разобрать данные пользователя Telegram');
  }

  const id = parsed['id'];
  if (typeof id !== 'number' && typeof id !== 'string') {
    throw new ApiError('unauthorized', 'В данных Telegram нет идентификатора пользователя');
  }

  const asString = (value: unknown): string | null =>
    typeof value === 'string' && value.length > 0 ? value : null;

  return {
    user: {
      id: String(id),
      username: asString(parsed['username']),
      firstName: asString(parsed['first_name']),
      lastName: asString(parsed['last_name']),
      photoUrl: asString(parsed['photo_url']),
      languageCode: asString(parsed['language_code']),
    },
    authDate,
    startParam: params.get('start_param'),
  };
}
