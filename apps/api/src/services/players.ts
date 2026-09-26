import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, like, or, sql } from 'drizzle-orm';
import {
  isBootstrapAdminDupr,
  isRoleAtLeast,
  isValidDuprId,
  normalizeDuprId,
  pairId,
  type BracketConfig,
  type CreatePlayerInput,
  type PlayerDto,
  type RatingSource,
  type UpdatePlayerInput,
} from '@fsp/shared';
import type { Database } from '../db/index.js';
import {
  accounts,
  claims,
  invites,
  matchPlayers,
  matches,
  playerRatingHistory,
  players,
  roundSitouts,
  tournamentPlayers,
  tournaments,
  trainingPlayers,
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
export function createGuestId(): string {
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
      ilike(players.duprId, `${normalized}%`),
    );
    if (search) filters.push(search);
  }

  const rows = await db
    .select()
    .from(players)
    .where(and(...filters))
    .orderBy(sql`${players.doublesRating} DESC NULLS LAST`, asc(players.lastName))
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

/**
 * Переносит заявки/матчи с гостевой карточки на уже существующую цель
 * (другой гость по invite или настоящий DUPR) и помечает гостя как слитого.
 */
export async function adoptGuestIntoPlayer(
  db: Database,
  guestId: string,
  targetId: string,
): Promise<void> {
  if (guestId === targetId) return;

  const guest = await getPlayerRow(db, guestId);
  if (!guest.isGuest) {
    throw new ApiError('validation_failed', 'У этого игрока уже есть DUPR ID');
  }
  const target = await getPlayerRow(db, targetId);
  if (target.mergedIntoId) {
    throw new ApiError('validation_failed', 'Целевая карточка уже объединена с другой');
  }

  await db.transaction(async (tx) => {
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
            eq(tournamentPlayers.playerId, targetId),
          ),
        )
        .limit(1);
      if (clash) {
        await tx.delete(tournamentPlayers).where(eq(tournamentPlayers.id, entry.id));
      } else {
        await tx
          .update(tournamentPlayers)
          .set({ playerId: targetId })
          .where(eq(tournamentPlayers.id, entry.id));
      }
    }

    const guestTrainings = await tx
      .select({ id: trainingPlayers.id, trainingId: trainingPlayers.trainingId })
      .from(trainingPlayers)
      .where(eq(trainingPlayers.playerId, guestId));

    for (const entry of guestTrainings) {
      const [clash] = await tx
        .select({ id: trainingPlayers.id })
        .from(trainingPlayers)
        .where(
          and(
            eq(trainingPlayers.trainingId, entry.trainingId),
            eq(trainingPlayers.playerId, targetId),
          ),
        )
        .limit(1);
      if (clash) {
        await tx.delete(trainingPlayers).where(eq(trainingPlayers.id, entry.id));
      } else {
        await tx
          .update(trainingPlayers)
          .set({ playerId: targetId })
          .where(eq(trainingPlayers.id, entry.id));
      }
    }

    await tx
      .update(matchPlayers)
      .set({ playerId: targetId })
      .where(eq(matchPlayers.playerId, guestId));
    await tx
      .update(playerRatingHistory)
      .set({ playerId: targetId })
      .where(eq(playerRatingHistory.playerId, guestId));

    // Напарник всё ещё указывает на G-… — без этого пара разваливается в UI.
    await tx
      .update(tournamentPlayers)
      .set({ partnerPlayerId: targetId, updatedAt: new Date() })
      .where(eq(tournamentPlayers.partnerPlayerId, guestId));

    const affectedTournaments = new Set(guestEntries.map((entry) => entry.tournamentId));
    for (const tournamentId of affectedTournaments) {
      await restoreOneWayPartnerLinks(tx, tournamentId);
    }
    // Фото может быть только на аккаунте (telegramPhotoUrl), а не на карточке гостя.
    const [guestAccount] = await tx
      .select({
        telegramUsername: accounts.telegramUsername,
        telegramPhotoUrl: accounts.telegramPhotoUrl,
      })
      .from(accounts)
      .where(eq(accounts.playerId, guestId))
      .limit(1);

    await tx.update(accounts).set({ playerId: targetId }).where(eq(accounts.playerId, guestId));
    await tx.update(claims).set({ playerId: targetId }).where(eq(claims.playerId, guestId));

    // Имя/фамилия: то, что уже есть на DUPR, не затираем гостем («Гость» и т.п.).
    const firstName = pickNonEmpty(target.firstName, guest.firstName) ?? target.firstName;
    const lastName = pickPreservedLastName(target.lastName, guest.lastName);

    // Контакты: предпочитаем данные гостя/аккаунта, иначе оставляем целевые.
    const telegramUsername =
      guest.telegramUsername ?? guestAccount?.telegramUsername ?? target.telegramUsername;
    const guestAvatar = guest.avatarUrl ?? guestAccount?.telegramPhotoUrl ?? null;
    const avatarUrl = guestAvatar ?? target.avatarUrl;
    const avatarSource = guestAvatar ? (guest.avatarSource ?? 'self') : target.avatarSource;

    await tx
      .update(players)
      .set({
        firstName,
        lastName,
        telegramUsername,
        avatarUrl,
        avatarSource,
        updatedAt: new Date(),
      })
      .where(eq(players.id, targetId));

    await tx
      .update(players)
      .set({ mergedIntoId: targetId, updatedAt: new Date() })
      .where(eq(players.id, guestId));
  });
}

/**
 * После merge гостя в DUPR: указатели partner_player_id на G-… и односторонние
 * связки (напарник ещё ссылается на гостя, DUPR — на игрока).
 */
export async function healMergedPartnerLinks(db: Database, tournamentId: string): Promise<boolean> {
  const stale = await db
    .select({
      id: tournamentPlayers.id,
      mergedIntoId: players.mergedIntoId,
    })
    .from(tournamentPlayers)
    .innerJoin(players, eq(tournamentPlayers.partnerPlayerId, players.id))
    .where(and(eq(tournamentPlayers.tournamentId, tournamentId), isNotNull(players.mergedIntoId)));

  let changed = false;
  const now = new Date();
  for (const row of stale) {
    if (!row.mergedIntoId) continue;
    await db
      .update(tournamentPlayers)
      .set({ partnerPlayerId: row.mergedIntoId, updatedAt: now })
      .where(eq(tournamentPlayers.id, row.id));
    changed = true;
  }

  if (await restoreOneWayPartnerLinks(db, tournamentId)) changed = true;
  return changed;
}

async function restoreOneWayPartnerLinks(
  db: Pick<Database, 'select' | 'update'>,
  tournamentId: string,
): Promise<boolean> {
  const rows = await db
    .select()
    .from(tournamentPlayers)
    .where(eq(tournamentPlayers.tournamentId, tournamentId));
  const byPlayer = new Map(rows.map((row) => [row.playerId, row]));
  const now = new Date();
  let changed = false;

  for (const row of rows) {
    const partnerId = row.partnerPlayerId;
    if (!partnerId) continue;
    const partner = byPlayer.get(partnerId);
    if (!partner) {
      await db
        .update(tournamentPlayers)
        .set({ partnerPlayerId: null, updatedAt: now })
        .where(eq(tournamentPlayers.id, row.id));
      changed = true;
      continue;
    }
    if (partner.partnerPlayerId === row.playerId) continue;
    if (partner.partnerPlayerId) continue;
    await db
      .update(tournamentPlayers)
      .set({ partnerPlayerId: row.playerId, updatedAt: now })
      .where(eq(tournamentPlayers.id, partner.id));
    partner.partnerPlayerId = row.playerId;
    changed = true;
  }

  return changed;
}

function pickNonEmpty(
  preferred: string | null | undefined,
  fallback: string | null | undefined,
): string | null {
  const a = preferred?.trim();
  if (a) return a;
  const b = fallback?.trim();
  return b || null;
}

/** Фамилию с DUPR сохраняем; «Гость»/«Guest» с гостя на пустую цель не переносим. */
function pickPreservedLastName(targetLastName: string, guestLastName: string): string {
  if (targetLastName.trim()) return targetLastName.trim();
  const guest = guestLastName.trim();
  if (!guest || isPlaceholderLastName(guest)) return targetLastName;
  return guest;
}

function isPlaceholderLastName(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === 'гость' || normalized === 'guest';
}

/**
 * Если DUPR-карточка пустая по контактам, а слитый гость ещё хранит @username/фото —
 * переносим их (лечит старые слияния до фикса adoptGuestIntoPlayer).
 */
export async function restoreContactsFromMergedGuests(
  db: Database,
  playerId: string,
): Promise<PlayerRow> {
  const player = await getPlayerRow(db, playerId);
  if (player.telegramUsername && player.avatarUrl) return player;

  const guests = await db.select().from(players).where(eq(players.mergedIntoId, playerId));

  const withTelegram = guests.find((row) => row.telegramUsername);
  const withAvatar = guests.find((row) => row.avatarUrl);
  if (!withTelegram && !withAvatar) return player;

  const telegramUsername = player.telegramUsername ?? withTelegram?.telegramUsername ?? null;
  const avatarUrl = player.avatarUrl ?? withAvatar?.avatarUrl ?? null;
  const avatarSource = player.avatarUrl
    ? player.avatarSource
    : withAvatar
      ? (withAvatar.avatarSource ?? 'self')
      : player.avatarSource;

  const [updated] = await db
    .update(players)
    .set({ telegramUsername, avatarUrl, avatarSource, updatedAt: new Date() })
    .where(eq(players.id, playerId))
    .returning();
  return updated ?? player;
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

  const [existing] = await db.select().from(players).where(eq(players.id, duprId)).limit(1);

  let target = existing;
  if (!target) {
    const [created] = await db
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

  await adoptGuestIntoPlayer(db, guestId, target.id);
  const merged = await getPlayerRow(db, target.id);
  return toPlayerDto(merged);
}

/**
 * Меняет DUPR ID у настоящей карточки.
 *
 * Ключ игрока поменять нельзя, поэтому история переезжает на карточку с новым
 * ID: матчи, заявки, пропуски кругов, сетка фиксированных пар и привязка
 * Telegram. Старая карточка остаётся архивной ссылкой и в списках не видна.
 * На занятый ID — с матчами или своим Telegram — перенос не делается.
 */
export async function reassignPlayerDuprId(
  db: Database,
  playerId: string,
  rawDuprId: string,
  actor: Viewer,
): Promise<PlayerDto> {
  if (actor.role !== 'admin') throw forbidden();

  const duprId = normalizeDuprId(rawDuprId);
  if (!isValidDuprId(duprId)) {
    throw new ApiError('validation_failed', 'DUPR ID указан неверно');
  }

  const source = await getPlayerRow(db, playerId);
  if (source.isGuest || !source.duprId) {
    throw new ApiError(
      'validation_failed',
      'Сменить DUPR ID можно только у игрока, у которого он уже указан',
    );
  }
  if (source.mergedIntoId) {
    throw new ApiError('validation_failed', 'Эта карточка уже объединена с другой');
  }
  if (duprId === source.id || duprId === normalizeDuprId(source.duprId)) {
    throw new ApiError('validation_failed', 'Укажите другой DUPR ID');
  }
  if (
    isBootstrapAdminDupr(source.duprId) ||
    isBootstrapAdminDupr(source.id) ||
    isBootstrapAdminDupr(duprId)
  ) {
    throw new ApiError('validation_failed', 'Этот DUPR ID зарезервирован для администратора клуба');
  }

  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(players).where(eq(players.id, duprId)).limit(1);
    if (!existing) {
      await tx.insert(players).values({
        id: duprId,
        duprId,
        firstName: source.firstName,
        lastName: source.lastName,
        doublesRating: source.doublesRating,
        singlesRating: source.singlesRating,
        ratingUpdatedAt: source.ratingUpdatedAt,
        ratingSource: source.ratingSource,
        avatarUrl: source.avatarUrl,
        telegramUsername: source.telegramUsername,
        nameSource: source.nameSource,
        avatarSource: source.avatarSource,
        clubRole: source.clubRole,
        isGuest: false,
      });
    } else {
      if (existing.mergedIntoId) {
        throw new ApiError('validation_failed', 'Целевая карточка уже объединена с другой');
      }
      if (existing.isGuest) {
        throw new ApiError('validation_failed', 'Нельзя перенести историю на гостевую карточку');
      }
      await assertDuprTargetIsEmpty(tx, duprId);
      const keepRating = existing.doublesRating != null;
      await tx
        .update(players)
        .set({
          duprId: existing.duprId ?? duprId,
          firstName: pickNonEmpty(existing.firstName, source.firstName) ?? existing.firstName,
          lastName: pickNonEmpty(existing.lastName, source.lastName) ?? existing.lastName,
          telegramUsername: source.telegramUsername ?? existing.telegramUsername,
          avatarUrl: source.avatarUrl ?? existing.avatarUrl,
          avatarSource: source.avatarUrl ? source.avatarSource : existing.avatarSource,
          clubRole: isRoleAtLeast(source.clubRole, existing.clubRole)
            ? source.clubRole
            : existing.clubRole,
          ...(keepRating
            ? {}
            : {
                doublesRating: source.doublesRating,
                singlesRating: source.singlesRating,
                ratingUpdatedAt: source.ratingUpdatedAt,
                ratingSource: source.ratingSource,
              }),
          updatedAt: new Date(),
        })
        .where(eq(players.id, duprId));
    }

    const affected = await tx
      .select({ tournamentId: tournamentPlayers.tournamentId })
      .from(tournamentPlayers)
      .where(
        or(
          eq(tournamentPlayers.playerId, source.id),
          eq(tournamentPlayers.partnerPlayerId, source.id),
        ),
      );

    await tx
      .update(tournamentPlayers)
      .set({ playerId: duprId })
      .where(eq(tournamentPlayers.playerId, source.id));
    await tx
      .update(tournamentPlayers)
      .set({ partnerPlayerId: duprId, updatedAt: new Date() })
      .where(eq(tournamentPlayers.partnerPlayerId, source.id));
    await tx
      .update(trainingPlayers)
      .set({ playerId: duprId })
      .where(eq(trainingPlayers.playerId, source.id));
    await tx
      .update(matchPlayers)
      .set({ playerId: duprId })
      .where(eq(matchPlayers.playerId, source.id));
    await tx
      .update(roundSitouts)
      .set({ playerId: duprId })
      .where(eq(roundSitouts.playerId, source.id));
    await tx
      .update(playerRatingHistory)
      .set({ playerId: duprId })
      .where(eq(playerRatingHistory.playerId, source.id));
    await tx.update(accounts).set({ playerId: duprId }).where(eq(accounts.playerId, source.id));
    await tx.update(claims).set({ playerId: duprId }).where(eq(claims.playerId, source.id));
    await tx.update(invites).set({ playerId: duprId }).where(eq(invites.playerId, source.id));

    for (const tournamentId of new Set(affected.map((row) => row.tournamentId))) {
      await restoreOneWayPartnerLinks(tx, tournamentId);
    }

    await rewriteStoredPairIds(tx, source.id, duprId);

    // Гости, которых раньше слили в старую карточку, должны указывать на новую.
    await tx
      .update(players)
      .set({ mergedIntoId: duprId, updatedAt: new Date() })
      .where(eq(players.mergedIntoId, source.id));
    await tx
      .update(players)
      .set({ mergedIntoId: duprId, updatedAt: new Date() })
      .where(eq(players.id, source.id));
  });

  await recordAudit(db, actor, {
    action: 'player.reassign_dupr',
    entityType: 'player',
    entityId: duprId,
    payload: {
      fromId: source.id,
      fromDuprId: source.duprId,
      toDuprId: duprId,
      fullName: `${source.firstName} ${source.lastName}`.trim(),
    },
  });

  return toPlayerDto(await getPlayerRow(db, duprId));
}

/** Пустая карточка из базы: правильный ID уже заведён, но игр и Telegram ещё нет. */
async function assertDuprTargetIsEmpty(
  db: Pick<Database, 'select'>,
  targetId: string,
): Promise<void> {
  const checks = await Promise.all([
    db
      .select({ id: matchPlayers.id })
      .from(matchPlayers)
      .where(eq(matchPlayers.playerId, targetId))
      .limit(1),
    db
      .select({ id: tournamentPlayers.id })
      .from(tournamentPlayers)
      .where(
        or(
          eq(tournamentPlayers.playerId, targetId),
          eq(tournamentPlayers.partnerPlayerId, targetId),
        ),
      )
      .limit(1),
    db
      .select({ id: trainingPlayers.id })
      .from(trainingPlayers)
      .where(eq(trainingPlayers.playerId, targetId))
      .limit(1),
    db.select({ id: accounts.id }).from(accounts).where(eq(accounts.playerId, targetId)).limit(1),
    db.select({ id: claims.id }).from(claims).where(eq(claims.playerId, targetId)).limit(1),
    db
      .select({ id: roundSitouts.id })
      .from(roundSitouts)
      .where(eq(roundSitouts.playerId, targetId))
      .limit(1),
    db
      .select({ token: invites.token })
      .from(invites)
      .where(eq(invites.playerId, targetId))
      .limit(1),
    db.select({ id: players.id }).from(players).where(eq(players.mergedIntoId, targetId)).limit(1),
  ]);
  if (checks.some((rows) => rows.length > 0)) {
    throw new ApiError(
      'validation_failed',
      'Этот DUPR ID уже используется другим игроком. Перенос возможен только на свободный ID или пустую карточку из базы.',
    );
  }
}

/**
 * В группе id пары зашит в ключ `pairGroups` и в слот матча `G1:a|b:c|d`.
 * После смены id строка должна собраться заново, иначе таблица группы
 * перестанет находить пару.
 */
async function rewriteStoredPairIds(
  db: Pick<Database, 'select' | 'update'>,
  fromId: string,
  toId: string,
): Promise<void> {
  const configs = await db
    .select({ id: tournaments.id, bracketConfig: tournaments.bracketConfig })
    .from(tournaments)
    .where(isNotNull(tournaments.bracketConfig));

  for (const row of configs) {
    const config = row.bracketConfig;
    if (!config?.pairGroups) continue;
    const nextGroups: Record<string, number> = {};
    let changed = false;
    for (const [key, group] of Object.entries(config.pairGroups)) {
      const rewritten = rewritePlayerTokens(key, fromId, toId);
      if (rewritten !== key) changed = true;
      if (
        Object.prototype.hasOwnProperty.call(nextGroups, rewritten) &&
        nextGroups[rewritten] !== group
      ) {
        throw new ApiError('validation_failed', 'Новый DUPR ID уже стоит в сетке турнира');
      }
      nextGroups[rewritten] = group;
    }
    if (!changed) continue;
    const bracketConfig: BracketConfig = { ...config, pairGroups: nextGroups };
    await db
      .update(tournaments)
      .set({ bracketConfig, updatedAt: new Date() })
      .where(eq(tournaments.id, row.id));
  }

  const slotRows = await db
    .select({ id: matches.id, bracketSlot: matches.bracketSlot })
    .from(matches)
    .where(like(matches.bracketSlot, `%${fromId}%`));

  for (const row of slotRows) {
    if (!row.bracketSlot) continue;
    const rewritten = rewritePlayerTokens(row.bracketSlot, fromId, toId);
    if (rewritten === row.bracketSlot) continue;
    await db
      .update(matches)
      .set({ bracketSlot: rewritten, updatedAt: new Date() })
      .where(eq(matches.id, row.id));
  }
}

/** Меняет id игрока только как целый токен в `a|b` и `G1:a|b:c|d`, затем сортирует пару. */
export function rewritePlayerTokens(value: string, fromId: string, toId: string): string {
  if (!value.includes(fromId)) return value;
  return value
    .split(':')
    .map((part) => rewritePairPart(part, fromId, toId))
    .join(':');
}

function rewritePairPart(part: string, fromId: string, toId: string): string {
  if (part === fromId) return toId;
  if (!part.includes('|') && !part.includes(fromId)) return part;
  const bits = part.split('|');
  if (!bits.includes(fromId)) return part;
  const next = bits.map((bit) => (bit === fromId ? toId : bit));
  if (next.length === 2 && next[0] && next[1]) return pairId(next[0], next[1]);
  return next.join('|');
}

/**
 * Полное удаление карточки из нашей базы.
 *
 * Аккаунт Telegram отвязывается (SET NULL), заявки и история участия уходят
 * каскадом. После повторного импорта или создания карточки с тем же DUPR ID
 * можно привязаться заново — как будто игрока не было.
 */
export async function deletePlayer(db: Database, playerId: string, actor: Viewer): Promise<void> {
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
