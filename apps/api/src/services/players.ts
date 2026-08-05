import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  isValidDuprId,
  normalizeDuprId,
  type CreatePlayerInput,
  type PlayerDto,
  type RatingSource,
  type UpdatePlayerInput,
} from '@fsp/shared';
import type { Database } from '../db/index.js';
import {
  accounts,
  claims,
  matchPlayers,
  matches,
  playerRatingHistory,
  players,
  tournamentPlayers,
  type PlayerRow,
} from '../db/schema.js';
import { ApiError, forbidden, notFound } from '../lib/errors.js';
import { recordAudit } from './audit.js';
import { toPlayerDto, toRatingHistoryDto } from './mappers.js';
import type { Viewer } from '../auth/context.js';

/** Убираем @ и пустые строки: в карточке храним только username. */
function normalizeTelegramUsername(value: string | null): string | null {
  if (value === null) return null;
  const cleaned = value.trim().replace(/^@+/, '');
  return cleaned === '' ? null : cleaned;
}

/** Гостевые карточки живут в том же пространстве ключей, но с явным префиксом. */
function createGuestId(): string {
  return `G-${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
}

async function claimedPlayerIds(db: Database, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ playerId: accounts.playerId })
    .from(accounts)
    .where(inArray(accounts.playerId, [...ids]));
  return new Set(rows.map((row) => row.playerId).filter((id): id is string => id !== null));
}

export async function toPlayerDtos(db: Database, rows: readonly PlayerRow[]): Promise<PlayerDto[]> {
  const claimed = await claimedPlayerIds(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toPlayerDto(row, { isClaimed: claimed.has(row.id) }));
}

export async function getPlayerRow(db: Database, playerId: string): Promise<PlayerRow> {
  const [row] = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
  if (!row) throw notFound('Игрок не найден');
  return row;
}

export interface SearchPlayersOptions {
  query?: string;
  limit?: number;
  includeGuests?: boolean;
}

export async function searchPlayers(
  db: Database,
  options: SearchPlayersOptions = {},
): Promise<PlayerDto[]> {
  const limit = Math.min(options.limit ?? 30, 100);
  const query = options.query?.trim() ?? '';
  const filters = [isNull(players.mergedIntoId)];

  if (!options.includeGuests) {
    filters.push(eq(players.isGuest, false));
  }
  if (query.length > 0) {
    const pattern = `%${query}%`;
    const normalized = normalizeDuprId(query);
    const search = or(
      ilike(players.firstName, pattern),
      ilike(players.lastName, pattern),
      ilike(sql`${players.firstName} || ' ' || ${players.lastName}`, pattern),
      eq(players.duprId, normalized),
    );
    if (search) filters.push(search);
  }

  const rows = await db
    .select()
    .from(players)
    .where(and(...filters))
    .orderBy(desc(players.doublesRating), asc(players.lastName))
    .limit(limit);

  return toPlayerDtos(db, rows);
}

export async function createPlayer(
  db: Database,
  input: CreatePlayerInput,
  actor: Viewer,
): Promise<PlayerDto> {
  const rawDupr = input.duprId?.trim() ? normalizeDuprId(input.duprId) : null;
  if (rawDupr && !isValidDuprId(rawDupr)) {
    throw new ApiError('validation_failed', 'DUPR ID указан неверно');
  }

  if (rawDupr) {
    const [existing] = await db.select().from(players).where(eq(players.id, rawDupr)).limit(1);
    if (existing) {
      throw new ApiError('duplicate_dupr_id', 'Игрок с таким DUPR ID уже есть в базе', {
        playerId: existing.id,
      });
    }
  }

  const id = rawDupr ?? createGuestId();
  const rating = input.doublesRating ?? null;

  const [row] = await db
    .insert(players)
    .values({
      id,
      duprId: rawDupr,
      firstName: input.firstName,
      lastName: input.lastName,
      doublesRating: rating,
      singlesRating: input.singlesRating ?? null,
      ratingUpdatedAt: rating === null ? null : new Date(),
      ratingSource: rating === null ? null : 'moderator',
      isGuest: rawDupr === null,
      nameSource: 'manual',
    })
    .returning();

  if (!row) throw new ApiError('internal', 'Не удалось создать карточку игрока');

  if (rating !== null) {
    await db.insert(playerRatingHistory).values({
      playerId: row.id,
      previousRating: null,
      rating,
      source: 'moderator',
      changedByAccountId: actor.accountId,
      changedByName: actor.displayName,
    });
  }

  return toPlayerDto(row);
}

export function canEditPlayer(viewer: Viewer | null, playerId: string): boolean {
  if (!viewer) return false;
  if (viewer.role === 'admin' || viewer.role === 'moderator') return true;
  return viewer.playerId === playerId;
}

export async function updatePlayer(
  db: Database,
  playerId: string,
  input: UpdatePlayerInput,
  actor: Viewer,
): Promise<PlayerDto> {
  const current = await getPlayerRow(db, playerId);
  if (!canEditPlayer(actor, playerId)) throw forbidden('Можно менять только свой профиль');

  const isSelf = actor.playerId === playerId;
  const patch: Partial<typeof players.$inferInsert> = { updatedAt: new Date() };

  if (input.firstName !== undefined || input.lastName !== undefined) {
    if (input.firstName !== undefined) patch.firstName = input.firstName;
    if (input.lastName !== undefined) patch.lastName = input.lastName;
    // Помечаем правку, чтобы следующий импорт справочника её не перетёр.
    patch.nameSource = isSelf ? 'self' : 'manual';
  }
  if (input.avatarUrl !== undefined) {
    patch.avatarUrl = input.avatarUrl;
    patch.avatarSource = input.avatarUrl === null ? null : isSelf ? 'self' : 'manual';
  }
  if (input.telegramUsername !== undefined) {
    patch.telegramUsername = normalizeTelegramUsername(input.telegramUsername);
  }
  if (input.singlesRating !== undefined) {
    patch.singlesRating = input.singlesRating;
  }

  await db.update(players).set(patch).where(eq(players.id, playerId));

  if (input.doublesRating !== undefined && input.doublesRating !== current.doublesRating) {
    return setDoublesRating(db, playerId, input.doublesRating, actor);
  }

  const [row] = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
  return toPlayerDto(row as PlayerRow);
}

/**
 * Ручное ведение парного рейтинга DUPR.
 *
 * К API DUPR приложение не обращается, поэтому значение поддерживают руками:
 * игрок у себя в профиле, организатор — у любого игрока. Каждое изменение
 * попадает в историю, чтобы опечатку можно было откатить.
 */
export async function setDoublesRating(
  db: Database,
  playerId: string,
  rating: number | null,
  actor: Viewer,
): Promise<PlayerDto> {
  const current = await getPlayerRow(db, playerId);
  if (!canEditPlayer(actor, playerId)) {
    throw forbidden('Менять рейтинг может сам игрок или организатор');
  }

  const source: RatingSource = actor.playerId === playerId ? 'self' : 'moderator';

  if (current.doublesRating === rating) {
    return toPlayerDto(current);
  }

  const [row] = await db
    .update(players)
    .set({
      doublesRating: rating,
      ratingUpdatedAt: rating === null ? null : new Date(),
      ratingSource: rating === null ? null : source,
      // Расхождение с выгрузкой считается разрешённым: человек только что решил.
      pendingImportRating: null,
      updatedAt: new Date(),
    })
    .where(eq(players.id, playerId))
    .returning();

  await db.insert(playerRatingHistory).values({
    playerId,
    previousRating: current.doublesRating,
    rating,
    source,
    changedByAccountId: actor.accountId,
    changedByName: actor.displayName,
  });

  return toPlayerDto(row as PlayerRow);
}

export async function getRatingHistory(db: Database, playerId: string) {
  const rows = await db
    .select()
    .from(playerRatingHistory)
    .where(eq(playerRatingHistory.playerId, playerId))
    .orderBy(desc(playerRatingHistory.createdAt))
    .limit(50);
  return rows.map(toRatingHistoryDto);
}

/** Принять или отклонить значение рейтинга из свежей выгрузки. */
export async function resolveRatingConflict(
  db: Database,
  playerId: string,
  accept: boolean,
  actor: Viewer,
): Promise<PlayerDto> {
  const current = await getPlayerRow(db, playerId);
  if (!canEditPlayer(actor, playerId)) throw forbidden();
  if (current.pendingImportRating === null) {
    return toPlayerDto(current);
  }

  if (!accept) {
    const [row] = await db
      .update(players)
      .set({ pendingImportRating: null, updatedAt: new Date() })
      .where(eq(players.id, playerId))
      .returning();
    return toPlayerDto(row as PlayerRow);
  }

  const rating = current.pendingImportRating;
  const [row] = await db
    .update(players)
    .set({
      doublesRating: rating,
      ratingUpdatedAt: new Date(),
      ratingSource: 'import',
      pendingImportRating: null,
      updatedAt: new Date(),
    })
    .where(eq(players.id, playerId))
    .returning();

  await db.insert(playerRatingHistory).values({
    playerId,
    previousRating: current.doublesRating,
    rating,
    source: 'import',
    changedByAccountId: actor.accountId,
    changedByName: actor.displayName,
  });

  return toPlayerDto(row as PlayerRow);
}

/**
 * Гость получил настоящий DUPR ID.
 *
 * Ключ игрока поменять нельзя, поэтому создаём или находим карточку с этим ID,
 * переносим на неё все матчи и заявки, а гостевую помечаем как слитую.
 */
export async function mergeGuestIntoDupr(
  db: Database,
  guestId: string,
  rawDuprId: string,
  actor: Viewer,
): Promise<PlayerDto> {
  const duprId = normalizeDuprId(rawDuprId);
  if (!isValidDuprId(duprId)) {
    throw new ApiError('validation_failed', 'DUPR ID указан неверно');
  }

  const guest = await getPlayerRow(db, guestId);
  if (!guest.isGuest) {
    throw new ApiError('validation_failed', 'У этого игрока уже есть DUPR ID');
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(players).where(eq(players.id, duprId)).limit(1);

    let target = existing;
    if (!target) {
      const [created] = await tx
        .insert(players)
        .values({
          id: duprId,
          duprId,
          firstName: guest.firstName,
          lastName: guest.lastName,
          doublesRating: guest.doublesRating,
          singlesRating: guest.singlesRating,
          ratingUpdatedAt: guest.ratingUpdatedAt,
          ratingSource: guest.ratingSource,
          avatarUrl: guest.avatarUrl,
          telegramUsername: guest.telegramUsername,
          nameSource: guest.nameSource,
          avatarSource: guest.avatarSource,
        })
        .returning();
      target = created as PlayerRow;
    }

    // Переносим историю участия. Уникальные ограничения могут конфликтовать,
    // если обе карточки участвовали в одном турнире — такие записи удаляем.
    const guestEntries = await tx
      .select({ id: tournamentPlayers.id, tournamentId: tournamentPlayers.tournamentId })
      .from(tournamentPlayers)
      .where(eq(tournamentPlayers.playerId, guestId));

    for (const entry of guestEntries) {
      const [clash] = await tx
        .select({ id: tournamentPlayers.id })
        .from(tournamentPlayers)
        .where(
          and(
            eq(tournamentPlayers.tournamentId, entry.tournamentId),
            eq(tournamentPlayers.playerId, target.id),
          ),
        )
        .limit(1);
      if (clash) {
        await tx.delete(tournamentPlayers).where(eq(tournamentPlayers.id, entry.id));
      } else {
        await tx
          .update(tournamentPlayers)
          .set({ playerId: target.id })
          .where(eq(tournamentPlayers.id, entry.id));
      }
    }

    await tx
      .update(matchPlayers)
      .set({ playerId: target.id })
      .where(eq(matchPlayers.playerId, guestId));
    await tx
      .update(playerRatingHistory)
      .set({ playerId: target.id })
      .where(eq(playerRatingHistory.playerId, guestId));

    // Telegram и заявки на привязку переезжают на карточку с настоящим DUPR.
    await tx.update(accounts).set({ playerId: target.id }).where(eq(accounts.playerId, guestId));
    await tx.update(claims).set({ playerId: target.id }).where(eq(claims.playerId, guestId));

    await tx
      .update(players)
      .set({ mergedIntoId: target.id, updatedAt: new Date() })
      .where(eq(players.id, guestId));

    return toPlayerDto(target);
  });
}

/**
 * Полное удаление карточки из нашей базы.
 *
 * Аккаунт Telegram отвязывается (SET NULL), заявки и история участия уходят
 * каскадом. После повторного импорта или создания карточки с тем же DUPR ID
 * можно привязаться заново — как будто игрока не было.
 */
export async function deletePlayer(
  db: Database,
  playerId: string,
  actor: Viewer,
): Promise<void> {
  const current = await getPlayerRow(db, playerId);

  await db.transaction(async (tx) => {
    // Гости, слитые в эту карточку, иначе останутся с битой ссылкой.
    await tx
      .update(players)
      .set({ mergedIntoId: null, updatedAt: new Date() })
      .where(eq(players.mergedIntoId, playerId));

    await tx.delete(players).where(eq(players.id, playerId));
  });

  await recordAudit(db, actor, {
    action: 'player.delete',
    entityType: 'player',
    entityId: playerId,
    payload: {
      duprId: current.duprId,
      fullName: `${current.firstName} ${current.lastName}`.trim(),
    },
  });
}

export async function getPlayerStats(db: Database, playerId: string) {
  const rows = await db
    .select({
      team: matchPlayers.team,
      scoreA: matches.scoreA,
      scoreB: matches.scoreB,
      tournamentId: matches.tournamentId,
    })
    .from(matchPlayers)
    .innerJoin(matches, eq(matches.id, matchPlayers.matchId))
    .where(and(eq(matchPlayers.playerId, playerId), eq(matches.status, 'finished')));

  let wins = 0;
  let losses = 0;
  let draws = 0;
  let pointsFor = 0;
  let pointsAgainst = 0;
  const tournamentIds = new Set<string>();

  for (const row of rows) {
    if (row.scoreA === null || row.scoreB === null) continue;
    tournamentIds.add(row.tournamentId);
    const own = row.team === 'A' ? row.scoreA : row.scoreB;
    const other = row.team === 'A' ? row.scoreB : row.scoreA;
    pointsFor += own;
    pointsAgainst += other;
    if (own > other) wins += 1;
    else if (own < other) losses += 1;
    else draws += 1;
  }

  return {
    matchesPlayed: wins + losses + draws,
    wins,
    losses,
    draws,
    pointsFor,
    pointsAgainst,
    tournamentIds: [...tournamentIds],
  };
}
