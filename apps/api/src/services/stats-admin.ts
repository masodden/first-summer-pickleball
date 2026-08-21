import { and, count, countDistinct, eq, gte, inArray, isNotNull, isNull, notExists, or, sql } from 'drizzle-orm';
import { formatDuprEventDate, type AdminStatsDto } from '@fsp/shared';
import type { Database } from '../db/index.js';
import {
  accounts,
  players,
  tournamentPlayers,
  tournaments,
  trainingPlayers,
  trainings,
} from '../db/schema.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Москва без перехода на летнее время: UTC+3 круглый год. */
export function startOfMoscowDay(now: Date): Date {
  return new Date(`${formatDuprEventDate(now)}T00:00:00+03:00`);
}

/** Начало календарного дня Москвы `daysAgo` дней назад, включая сегодня как 0. */
export function moscowDayStartDaysAgo(now: Date, daysAgo: number): Date {
  return new Date(startOfMoscowDay(now).getTime() - daysAgo * DAY_MS);
}

export function adminStatsWindows(now: Date): {
  todayStart: Date;
  weekStart: Date;
  monthStart: Date;
} {
  return {
    todayStart: startOfMoscowDay(now),
    weekStart: moscowDayStartDaysAgo(now, 6),
    monthStart: moscowDayStartDaysAgo(now, 29),
  };
}

function asCount(value: unknown): number {
  return Number(value ?? 0);
}

function asAvg(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Админская сводка по уже лежащим таблицам.
 * Заходы — last_seen_at; участие — события за 30 календарных дней Москвы.
 */
export async function getAdminStats(db: Database, now = new Date()): Promise<AdminStatsDto> {
  const { todayStart, weekStart, monthStart } = adminStatsWindows(now);
  const registered = eq(tournamentPlayers.status, 'registered');
  const trainingRegistered = eq(trainingPlayers.status, 'registered');

  const [
    allTime,
    today,
    week,
    month,
    new30d,
    identity,
    neverJoined,
    tournamentPlayers30d,
    openPlayPlayers30d,
    tournamentJoins,
    openPlayJoins,
    tournamentDupr,
  ] = await Promise.all([
    db.select({ total: count() }).from(accounts),
    db.select({ total: count() }).from(accounts).where(gte(accounts.lastSeenAt, todayStart)),
    db.select({ total: count() }).from(accounts).where(gte(accounts.lastSeenAt, weekStart)),
    db.select({ total: count() }).from(accounts).where(gte(accounts.lastSeenAt, monthStart)),
    db.select({ total: count() }).from(accounts).where(gte(accounts.createdAt, monthStart)),
    db
      .select({
        guests: sql<number>`count(*) filter (where ${players.isGuest})`.mapWith(Number),
        claimed: sql<number>`count(*) filter (where not ${players.isGuest})`.mapWith(Number),
      })
      .from(accounts)
      .innerJoin(players, eq(players.id, accounts.playerId)),
    db
      .select({ total: count() })
      .from(accounts)
      .where(
        or(
          isNull(accounts.playerId),
          and(
            notExists(
              db
                .select({ id: tournamentPlayers.id })
                .from(tournamentPlayers)
                .where(eq(tournamentPlayers.playerId, accounts.playerId)),
            ),
            notExists(
              db
                .select({ id: trainingPlayers.id })
                .from(trainingPlayers)
                .where(eq(trainingPlayers.playerId, accounts.playerId)),
            ),
          ),
        ),
      ),
    db
      .select({ total: countDistinct(tournamentPlayers.playerId) })
      .from(tournamentPlayers)
      .innerJoin(tournaments, eq(tournaments.id, tournamentPlayers.tournamentId))
      .where(
        and(registered, isNull(tournaments.deletedAt), gte(tournaments.startsAt, monthStart)),
      ),
    db
      .select({ total: countDistinct(trainingPlayers.playerId) })
      .from(trainingPlayers)
      .innerJoin(trainings, eq(trainings.id, trainingPlayers.trainingId))
      .where(
        and(
          trainingRegistered,
          isNull(trainings.deletedAt),
          gte(trainings.startsAt, monthStart),
        ),
      ),
    db
      .select({
        self: sql<number>`count(*) filter (where ${tournamentPlayers.addedBySelf})`.mapWith(Number),
        staff: sql<number>`count(*) filter (where not ${tournamentPlayers.addedBySelf})`.mapWith(
          Number,
        ),
      })
      .from(tournamentPlayers)
      .innerJoin(tournaments, eq(tournaments.id, tournamentPlayers.tournamentId))
      .where(
        and(registered, isNull(tournaments.deletedAt), gte(tournaments.startsAt, monthStart)),
      ),
    db
      .select({
        self: sql<number>`count(*) filter (where ${trainingPlayers.addedBySelf})`.mapWith(Number),
        staff: sql<number>`count(*) filter (where not ${trainingPlayers.addedBySelf})`.mapWith(
          Number,
        ),
      })
      .from(trainingPlayers)
      .innerJoin(trainings, eq(trainings.id, trainingPlayers.trainingId))
      .where(
        and(
          trainingRegistered,
          isNull(trainings.deletedAt),
          gte(trainings.startsAt, monthStart),
        ),
      ),
    db
      .select({
        avg: sql<number | null>`avg(${players.doublesRating})`,
      })
      .from(players)
      .where(
        and(
          isNotNull(players.doublesRating),
          inArray(
            players.id,
            db
              .selectDistinct({ id: tournamentPlayers.playerId })
              .from(tournamentPlayers)
              .innerJoin(tournaments, eq(tournaments.id, tournamentPlayers.tournamentId))
              .where(
                and(
                  registered,
                  isNull(tournaments.deletedAt),
                  gte(tournaments.startsAt, monthStart),
                ),
              ),
          ),
        ),
      ),
  ]);

  return {
    uniqueToday: asCount(today[0]?.total),
    unique7d: asCount(week[0]?.total),
    unique30d: asCount(month[0]?.total),
    uniqueAllTime: asCount(allTime[0]?.total),
    uniqueNew30d: asCount(new30d[0]?.total),
    uniqueGuests: asCount(identity[0]?.guests),
    uniqueClaimed: asCount(identity[0]?.claimed),
    uniqueTournamentPlayers30d: asCount(tournamentPlayers30d[0]?.total),
    uniqueOpenPlayPlayers30d: asCount(openPlayPlayers30d[0]?.total),
    neverJoined: asCount(neverJoined[0]?.total),
    selfJoined30d: asCount(tournamentJoins[0]?.self) + asCount(openPlayJoins[0]?.self),
    staffAdded30d: asCount(tournamentJoins[0]?.staff) + asCount(openPlayJoins[0]?.staff),
    avgTournamentDupr30d: asAvg(tournamentDupr[0]?.avg),
  };
}
