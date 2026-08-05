import { Bot } from 'grammy';
import type { Env } from '../env.js';

export interface BotBundle {
  bot: Bot;
  /** Запускает long polling; для вебхука не используется. */
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Telegram-бот. Его задача скромная: открыть Mini App и доставлять уведомления.
 * Вся логика турниров живёт в приложении, поэтому команд у бота минимум.
 */
export function createBot(env: Env): BotBundle | null {
  if (!env.TELEGRAM_BOT_TOKEN) return null;

  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);
  const appUrl = env.PUBLIC_WEB_URL.replace(/\/$/, '');

  bot.command('start', async (ctx) => {
    const payload = ctx.match?.trim() ?? '';
    // Deep-link: invite_<token> или t_<uuid турнира>.
    const inviteToken = payload.startsWith('invite_') ? payload.slice('invite_'.length) : null;
    const tournamentId = payload.startsWith('t_') ? payload.slice(2) : null;

    let url = appUrl;
    let text =
      'FIRST SUMMER PICKLEBALL — турниры клуба. Откройте приложение, чтобы посмотреть турниры и заявиться.';
    if (inviteToken) {
      url = `${appUrl}/?invite=${encodeURIComponent(inviteToken)}`;
      text = 'Откройте приложение, чтобы привязать свою карточку игрока.';
    } else if (tournamentId) {
      url = `${appUrl}/?tournament=${encodeURIComponent(tournamentId)}`;
      text = 'Откройте приложение, чтобы перейти к турниру.';
    }

    await ctx.reply(text, {
      reply_markup: {
        inline_keyboard: [[{ text: 'Открыть приложение', web_app: { url } }]],
      },
    });
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      'Все действия происходят в приложении: список турниров, регистрация, счёт и таблица.\n' +
        'Нажмите кнопку меню слева от поля ввода или отправьте /start.',
    );
  });

  return {
    bot,
    async start() {
      await bot.api.setChatMenuButton({
        menu_button: {
          type: 'web_app',
          text: 'Турниры',
          web_app: { url: appUrl },
        },
      });
      await bot.start({ drop_pending_updates: true });
    },
    async stop() {
      await bot.stop();
    },
  };
}
