import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { webhookCallback } from 'grammy';
import { ZodError } from 'zod';
import { ApiError } from './lib/errors.js';
import { loadEnv } from './env.js';
import { getDb, closeDb } from './db/index.js';
import { registerViewerContext } from './auth/context.js';
import { RealtimeHub } from './realtime/hub.js';
import { createBot } from './bot/bot.js';
import { createNoopSender, createTelegramSender } from './bot/notifications.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerPlayerRoutes } from './routes/players.js';
import { registerTournamentRoutes } from './routes/tournaments.js';
import { registerMatchRoutes } from './routes/matches.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerWebsocket } from './routes/ws.js';
import type { AppContext } from './routes/context.js';

export async function buildServer() {
  const env = loadEnv();
  const db = getDb();
  const hub = new RealtimeHub();

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(env.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }
        : {}),
    },
    trustProxy: true,
    bodyLimit: 25 * 1024 * 1024,
  });

  await app.register(cors, {
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map((item) => item.trim()),
    credentials: true,
  });
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_TTL },
  });
  await app.register(rateLimit, {
    max: 600,
    timeWindow: '1 minute',
    // Живой турнир — это много быстрых действий, поэтому лимит щедрый,
    // но защищает от случайного цикла на клиенте.
    allowList: () => false,
  });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  const botBundle = createBot(env);
  const notify = botBundle
    ? createTelegramSender(db, botBundle.bot.api, (error) =>
        app.log.warn({ err: error }, 'Не удалось отправить уведомление в Telegram'),
      )
    : createNoopSender();

  const ctx: AppContext = { db, hub, env, notify };

  registerViewerContext(app, db);

  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    if (error instanceof ApiError) {
      reply.code(error.statusCode).send(error.toBody());
      return;
    }
    if (error instanceof ZodError) {
      reply
        .code(422)
        .send(new ApiError('validation_failed', 'Проверьте заполненные поля').toBody());
      return;
    }
    if (error.statusCode === 429) {
      reply.code(429).send(new ApiError('rate_limited', 'Слишком много запросов').toBody());
      return;
    }
    if (error.statusCode && error.statusCode < 500) {
      reply.code(error.statusCode).send(new ApiError('validation_failed', error.message).toBody());
      return;
    }

    request.log.error({ err: error }, 'Необработанная ошибка');
    reply.code(500).send(new ApiError('internal', 'Что-то сломалось на сервере').toBody());
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send(new ApiError('not_found', 'Маршрут не найден').toBody());
  });

  app.get('/api/health', async () => ({
    ok: true,
    time: new Date().toISOString(),
    telegram: Boolean(env.TELEGRAM_BOT_TOKEN),
    devLogin: env.ALLOW_DEV_LOGIN,
  }));

  registerAuthRoutes(app, ctx);
  registerPlayerRoutes(app, ctx);
  registerTournamentRoutes(app, ctx);
  registerMatchRoutes(app, ctx);
  registerAdminRoutes(app, ctx);
  registerPublicRoutes(app, ctx);
  registerWebsocket(app, ctx);

  // Вебхук предпочтительнее long polling: на VPS с HTTPS он экономнее и быстрее.
  if (botBundle && env.TELEGRAM_WEBHOOK_SECRET) {
    const handler = webhookCallback(botBundle.bot, 'fastify', {
      secretToken: env.TELEGRAM_WEBHOOK_SECRET,
    });
    app.post(`/api/telegram/webhook`, handler);
    app.log.info('Telegram-бот работает через вебхук /api/telegram/webhook');
  }

  return { app, env, botBundle, hub };
}

async function main(): Promise<void> {
  const { app, env, botBundle } = await buildServer();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Останавливаюсь');
    try {
      await botBundle?.stop();
    } catch {
      // Бот мог не запуститься — это не мешает остановке.
    }
    await app.close();
    await closeDb();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: env.HOST, port: env.PORT });

  if (botBundle && !env.TELEGRAM_WEBHOOK_SECRET) {
    // Без публичного HTTPS вебхук недоступен, поэтому в локальной разработке
    // бот работает опросом.
    void botBundle.start().catch((error: unknown) => {
      app.log.warn({ err: error }, 'Не удалось запустить Telegram-бота');
    });
  }
}

const isEntrypoint = process.argv[1]?.includes('server');
if (isEntrypoint) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
