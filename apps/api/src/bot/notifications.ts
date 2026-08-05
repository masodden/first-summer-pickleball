import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { accounts, tournamentPlayers } from '../db/schema.js';

export interface NotificationSender {
  sendToPlayers(playerIds: readonly string[], text: string): Promise<void>;
  sendToTournament(tournamentId: string, text: string): Promise<void>;
}

/** Заглушка на случай, когда токен бота не задан: приложение работает и без него. */
export function createNoopSender(): NotificationSender {
  return {
    async sendToPlayers() {},
    async sendToTournament() {},
  };
}

export interface TelegramMessageApi {
  sendMessage(chatId: string, text: string, options?: unknown): Promise<unknown>;
}

/**
 * Уведомления приходят только тем, кто вошёл через Telegram и не отключил их в
 * настройках. Ошибки доставки не должны ломать турнир, поэтому они только
 * логируются.
 */
export function createTelegramSender(
  db: Database,
  api: TelegramMessageApi,
  onError: (error: unknown) => void = () => {},
): NotificationSender {
  async function chatIdsForPlayers(playerIds: readonly string[]): Promise<string[]> {
    if (playerIds.length === 0) return [];
    const rows = await db
      .select({ telegramId: accounts.telegramId })
      .from(accounts)
      .where(
        and(inArray(accounts.playerId, [...playerIds]), eq(accounts.notificationsEnabled, true)),
      );
    return rows.map((row) => row.telegramId);
  }

  async function deliver(chatIds: readonly string[], text: string): Promise<void> {
    for (const chatId of chatIds) {
      try {
        await api.sendMessage(chatId, text, { parse_mode: 'HTML' });
      } catch (error) {
        onError(error);
      }
    }
  }

  return {
    async sendToPlayers(playerIds, text) {
      await deliver(await chatIdsForPlayers(playerIds), text);
    },
    async sendToTournament(tournamentId, text) {
      const rows = await db
        .select({ playerId: tournamentPlayers.playerId })
        .from(tournamentPlayers)
        .where(
          and(
            eq(tournamentPlayers.tournamentId, tournamentId),
            eq(tournamentPlayers.status, 'registered'),
          ),
        );
      await deliver(await chatIdsForPlayers(rows.map((row) => row.playerId)), text);
    },
  };
}
