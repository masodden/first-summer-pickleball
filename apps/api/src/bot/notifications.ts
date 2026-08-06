import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import {
  accounts,
  matchPlayers,
  matches,
  roundSitouts,
  rounds,
  tournamentPlayers,
} from '../db/schema.js';

export interface NotificationSender {
  sendToPlayers(playerIds: readonly string[], text: string): Promise<void>;
  /**
   * Только основной состав турнира (`registered`), у кого привязан Telegram.
   * Не рассылает всем аккаунтам бота и не затрагивает лист ожидания.
   */
  sendToTournament(tournamentId: string, text: string): Promise<void>;
  /**
   * Игроки, которые реально стоят в расписании (корты + сидящие в раунде).
   * Для старта и «раунд готов» — чтобы сообщение не ушло тем, кого нет в играх.
   */
  sendToSchedule(tournamentId: string, text: string, roundIndex?: number): Promise<void>;
}

/** Заглушка на случай, когда токен бота не задан: приложение работает и без него. */
export function createNoopSender(): NotificationSender {
  return {
    async sendToPlayers() {},
    async sendToTournament() {},
    async sendToSchedule() {},
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
    const unique = [...new Set(playerIds.filter((id) => id.length > 0))];
    if (unique.length === 0) return [];

    const rows = await db
      .select({ telegramId: accounts.telegramId })
      .from(accounts)
      .where(
        and(inArray(accounts.playerId, unique), eq(accounts.notificationsEnabled, true)),
      );

    // Один Telegram — один чат, даже если в выборке дубли.
    return [...new Set(rows.map((row) => row.telegramId))];
  }

  async function registeredPlayerIds(tournamentId: string): Promise<string[]> {
    const rows = await db
      .select({ playerId: tournamentPlayers.playerId })
      .from(tournamentPlayers)
      .where(
        and(
          eq(tournamentPlayers.tournamentId, tournamentId),
          eq(tournamentPlayers.status, 'registered'),
        ),
      );
    return rows.map((row) => row.playerId);
  }

  /**
   * Пересечение «состав турнира» ∩ «есть в расписании».
   * Так сообщение о старте/раунде не уйдёт случайно записавшимся, которых
   * уже убрали из игр, и не уйдёт вообще всем, у кого включены уведомления.
   */
  async function schedulePlayerIds(
    tournamentId: string,
    roundIndex?: number,
  ): Promise<string[]> {
    const registered = new Set(await registeredPlayerIds(tournamentId));
    if (registered.size === 0) return [];

    const matchFilter =
      roundIndex === undefined
        ? eq(matches.tournamentId, tournamentId)
        : and(eq(matches.tournamentId, tournamentId), eq(matches.roundIndex, roundIndex));

    const onCourt = await db
      .select({ playerId: matchPlayers.playerId })
      .from(matchPlayers)
      .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
      .where(matchFilter);

    const sitoutQuery = db
      .select({ playerId: roundSitouts.playerId })
      .from(roundSitouts)
      .innerJoin(rounds, eq(rounds.id, roundSitouts.roundId))
      .where(
        roundIndex === undefined
          ? eq(rounds.tournamentId, tournamentId)
          : and(eq(rounds.tournamentId, tournamentId), eq(rounds.index, roundIndex)),
      );
    const sitting = await sitoutQuery;

    const ids = new Set<string>();
    for (const row of [...onCourt, ...sitting]) {
      if (registered.has(row.playerId)) ids.add(row.playerId);
    }
    return [...ids];
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
      await deliver(await chatIdsForPlayers(await registeredPlayerIds(tournamentId)), text);
    },
    async sendToSchedule(tournamentId, text, roundIndex) {
      await deliver(
        await chatIdsForPlayers(await schedulePlayerIds(tournamentId, roundIndex)),
        text,
      );
    },
  };
}
