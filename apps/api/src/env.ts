import { z } from 'zod';

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === 'boolean' ? value : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()),
  );

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  DATABASE_URL: z.string().min(1),

  /** Секрет для подписи токенов сессии приложения. */
  JWT_SECRET: z.string().min(16),
  JWT_TTL: z.string().default('30d'),

  /** Токен бота из BotFather. Без него вход через Telegram недоступен. */
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().optional(),
  /** Секрет вебхука Telegram; если пуст, бот работает в режиме long polling. */
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),

  /** Код для первой привязки зашитых администраторов. */
  BOOTSTRAP_ADMIN_CODE: z.string().min(1).default('first-summer-admin'),

  /** Публичный адрес приложения: нужен для ссылок-приглашений и Mini App. */
  PUBLIC_WEB_URL: z.string().default('http://localhost:4200'),
  CORS_ORIGIN: z.string().default('*'),

  /**
   * Локальный вход без Telegram. Нужен, чтобы разработчик мог зайти под любой
   * ролью в докере. В продакшене всегда выключен.
   */
  ALLOW_DEV_LOGIN: booleanish.default(false),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Некорректная конфигурация окружения:\n${issues}`);
  }
  cached = parsed.data;
  if (cached.NODE_ENV === 'production' && cached.ALLOW_DEV_LOGIN) {
    throw new Error('ALLOW_DEV_LOGIN нельзя включать в продакшене');
  }
  return cached;
}

export const isProduction = (): boolean => loadEnv().NODE_ENV === 'production';
