import { randomBytes } from 'node:crypto';
import { and, asc, count, desc, eq, inArray, isNull, max, ne, notInArray, sql } from 'drizzle-orm';
import {
  isTournamentClosed,
  normalizeCourtNames,
  type CreateTournamentInput,
  type ParticipantDto,
  type StandingsSortKey,
  type TournamentDto,
  type TournamentSummaryDto,
  type UpdateTournamentInput,
} from '@fsp/shared';
import type { Database } from '../db/index.js';
import {
  matches,
  players,
  rounds,
  tournamentPlayers,
  tournaments,
  type PlayerRow,
  type TournamentPlayerRow,
  type TournamentRow,
} from '../db/schema.js';
import { ApiError, forbidden, notFound, wrongStatus } from '../lib/errors.js';
import { toParticipantDto, toPlayerDto } from './mappers.js';
import { canManageTournaments, isAdmin, type Viewer } from '../auth/context.js';
import { recordAudit } from './audit.js';

function createSlug(): string {
  return randomBytes(6).toString('base64url').toLowerCase();
}

export async function getTournamentRow(db: Database, id: string): Promise<TournamentRow> {
  const [row] = await db
    .select()
    .from(tournaments)
    .where(and(eq(tournaments.id, id), isNull(tournaments.deletedAt)))
    .limit(1);
  if (!row) throw notFound('Турнир не найден');
  return row;
}

interface TournamentCounts {
  participantCount: number;
  confirmedCount: number;
  roundsGenerated: number;
}

async function loadCounts(db: Database, tournamentId: string): Promise<TournamentCounts> {
  const [participants] = await db
    .select({
      total: count(),
      confirmed: sql<number>`count(*) filter (where ${tournamentPlayers.confirmedAndPaid})`.mapWith(
        Number,
      ),
    })
    .from(tournamentPlayers)
    .where(
      and(
        eq(tournamentPlayers.tournamentId, tournamentId),
        eq(tournamentPlayers.status, 'registered'),
      ),
    );

  const [roundInfo] = await db
    .select({ total: count() })
    .from(rounds)
    .where(eq(rounds.tournamentId, tournamentId));

  return {
    participantCount: Number(participants?.total ?? 0),
    confirmedCount: Number(participants?.confirmed ?? 0),
    roundsGenerated: Number(roundInfo?.total ?? 0),
  };
}

export function toSummaryDto(row: TournamentRow, counts: TournamentCounts): TournamentSummaryDto {
  return {
    id: row.id,
    publicSlug: row.publicSlug,
    title: row.title,
    category: row.category,
    format: row.format,
    status: row.status,
    startsAt: row.startsAt.toISOString(),
    venueName: row.venueName,
    courts: row.courts,
    courtNames: row.courtNames,
    maxPlayers: row.maxPlayers,
    participantCount: counts.participantCount,
    confirmedCount: counts.confirmedCount,
    roundsPlanned: row.roundsPlanned,
    tieRule: row.tieRule,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toTournamentDto(
  row: TournamentRow,
  counts: TournamentCounts,
  viewer: Viewer | null,
  myParticipation: ParticipantDto | null,
): TournamentDto {
  return {
    ...toSummaryDto(row, counts),
    description: row.description,
    formatDescription: row.formatDescription,
    venueAddress: row.venueAddress,
    venueMapUrl: row.venueMapUrl,
    pointsToWin: row.pointsToWin,
    matchDurationMin: row.matchDurationMin,
    standingsSort: row.standingsSort as StandingsSortKey[],
    ratingBalance: row.ratingBalance,
    entryFee: row.entryFee,
    roundsGenerated: counts.roundsGenerated,
    updatedAt: row.updatedAt.toISOString(),
    canManage: canManageTournaments(viewer),
    canDelete: isAdmin(viewer),
    myParticipation,
  };
}

export async function listTournaments(
  db: Database,
  viewer: Viewer | null,
): Promise<TournamentSummaryDto[]> {
  void viewer;

  // Приоритет: идущие → остальные активные → завершённые → архив; внутри — дата.
  const rows = await db
    .select()
    .from(tournaments)
    .where(isNull(tournaments.deletedAt))
    .orderBy(
      sql`case ${tournaments.status}
        when 'running' then 0
        when 'finished' then 2
        when 'archived' then 3
        else 1
      end`,
      sql`case when ${tournaments.status} in ('finished', 'archived') then ${tournaments.startsAt} end desc nulls last`,
      sql`case when ${tournaments.status} not in ('finished', 'archived') then ${tournaments.startsAt} end asc nulls last`,
      desc(tournaments.createdAt),
    );

  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);

  // Считаем отдельно (не correlated subquery): в Drizzle подзапросы с table
  // в sql`` иногда дают 0 даже при живом составе.
  const participantRows = await db
    .select({
      tournamentId: tournamentPlayers.tournamentId,
      participantCount: sql<number>`count(*)`.mapWith(Number),
      confirmedCount: sql<number>`count(*) filter (where ${tournamentPlayers.confirmedAndPaid})`.mapWith(
        Number,
      ),
    })
    .from(tournamentPlayers)
    .where(
      and(inArray(tournamentPlayers.tournamentId, ids), eq(tournamentPlayers.status, 'registered')),
    )
    .groupBy(tournamentPlayers.tournamentId);

  const roundRows = await db
    .select({
      tournamentId: rounds.tournamentId,
      roundsGenerated: sql<number>`count(*)`.mapWith(Number),
    })
    .from(rounds)
    .where(inArray(rounds.tournamentId, ids))
    .groupBy(rounds.tournamentId);

  const participantsById = new Map(
    participantRows.map((row) => [
      row.tournamentId,
      {
        participantCount: row.participantCount,
        confirmedCount: row.confirmedCount,
      },
    ]),
  );
  const roundsById = new Map(roundRows.map((row) => [row.tournamentId, row.roundsGenerated]));

  return rows.map((row) => {
    const participants = participantsById.get(row.id);
    return toSummaryDto(row, {
      participantCount: participants?.participantCount ?? 0,
      confirmedCount: participants?.confirmedCount ?? 0,
      roundsGenerated: roundsById.get(row.id) ?? 0,
    });
  });
}

async function findParticipation(
  db: Database,
  tournamentId: string,
  playerId: string | null,
): Promise<ParticipantDto | null> {
  if (!playerId) return null;
  const [row] = await db
    .select({ participant: tournamentPlayers, player: players })
    .from(tournamentPlayers)
    .innerJoin(players, eq(players.id, tournamentPlayers.playerId))
    .where(
      and(
        eq(tournamentPlayers.tournamentId, tournamentId),
        eq(tournamentPlayers.playerId, playerId),
      ),
    )
    .limit(1);
  if (!row) return null;
  return toParticipantDto(row.participant, toPlayerDto(row.player));
}

export async function getTournamentDto(
  db: Database,
  id: string,
  viewer: Viewer | null,
): Promise<TournamentDto> {
  const row = await getTournamentRow(db, id);
  const counts = await loadCounts(db, id);
  const participation = await findParticipation(db, id, viewer?.playerId ?? null);
  return toTournamentDto(row, counts, viewer, participation);
}

export async function createTournament(
  db: Database,
  input: CreateTournamentInput,
  actor: Viewer,
): Promise<TournamentDto> {
  if (!canManageTournaments(actor)) throw forbidden('Создавать турниры может организатор');

  const [row] = await db
    .insert(tournaments)
    .values({
      title: input.title,
      category: input.category ?? null,
      format: input.format,
      startsAt: new Date(input.startsAt),
      courts: input.courts,
      courtNames: normalizeCourtNames(input.courtNames, input.courts),
      maxPlayers: input.maxPlayers,
      pointsToWin: input.pointsToWin,
      matchDurationMin: input.matchDurationMin ?? null,
      roundsPlanned: input.roundsPlanned ?? null,
      tieRule: input.tieRule ?? 'draw',
      standingsSort: input.standingsSort ?? ['wins', 'points', 'diff'],
      ratingBalance: input.ratingBalance ?? true,
      entryFee: input.entryFee ?? null,
      description: input.description ?? null,
      formatDescription: input.formatDescription ?? null,
      venueName: input.venueName ?? null,
      venueAddress: input.venueAddress ?? null,
      venueMapUrl: input.venueMapUrl ?? null,
      publicSlug: createSlug(),
      createdByAccountId: actor.accountId,
    })
    .returning();

  if (!row) throw new ApiError('internal', 'Не удалось создать турнир');

  await recordAudit(db, actor, {
    action: 'tournament.created',
    entityType: 'tournament',
    entityId: row.id,
    tournamentId: row.id,
    payload: { title: row.title, format: row.format },
  });

  return toTournamentDto(
    row,
    { participantCount: 0, confirmedCount: 0, roundsGenerated: 0 },
    actor,
    null,
  );
}

export async function updateTournament(
  db: Database,
  id: string,
  input: UpdateTournamentInput,
  actor: Viewer,
): Promise<TournamentDto> {
  const current = await getTournamentRow(db, id);
  if (!canManageTournaments(actor)) throw forbidden();
  if (isTournamentClosed(current.status)) {
    throw wrongStatus('Завершённый турнир изменить нельзя');
  }

  const patch: Partial<typeof tournaments.$inferInsert> = { updatedAt: new Date() };
  const assign = <K extends keyof typeof patch>(key: K, value: (typeof patch)[K]): void => {
    if (value !== undefined) patch[key] = value;
  };

  assign('title', input.title);
  assign('category', input.category ?? undefined);
  assign('format', input.format);
  assign('courts', input.courts);
  assign('maxPlayers', input.maxPlayers);
  assign('pointsToWin', input.pointsToWin);
  assign('matchDurationMin', input.matchDurationMin);
  assign('roundsPlanned', input.roundsPlanned);
  assign('tieRule', input.tieRule);
  assign('standingsSort', input.standingsSort);
  assign('ratingBalance', input.ratingBalance);
  assign('entryFee', input.entryFee);
  assign('description', input.description);
  assign('formatDescription', input.formatDescription);
  assign('venueName', input.venueName);
  assign('venueAddress', input.venueAddress);
  assign('venueMapUrl', input.venueMapUrl);
  if (input.startsAt !== undefined) patch.startsAt = new Date(input.startsAt);

  // Названия хранятся по одному на корт, поэтому при смене их количества список
  // подрезается или дополняется — иначе подписи разъехались бы с кортами.
  const courts = input.courts ?? current.courts;
  if (input.courtNames !== undefined) {
    patch.courtNames = normalizeCourtNames(input.courtNames, courts);
  } else if (input.courts !== undefined && current.courtNames) {
    patch.courtNames = normalizeCourtNames(current.courtNames, courts);
  }

  // Формат нельзя менять, когда уже созданы игры: расписание станет несогласованным.
  if (
    input.format !== undefined &&
    input.format !== current.format &&
    current.status === 'running'
  ) {
    throw wrongStatus('Формат нельзя менять после старта турнира');
  }

  await db.update(tournaments).set(patch).where(eq(tournaments.id, id));
  await recordAudit(db, actor, {
    action: 'tournament.updated',
    entityType: 'tournament',
    entityId: id,
    tournamentId: id,
    payload: { fields: Object.keys(patch) },
  });

  return getTournamentDto(db, id, actor);
}

export async function deleteTournament(db: Database, id: string, actor: Viewer): Promise<void> {
  await getTournamentRow(db, id);
  if (!isAdmin(actor)) throw forbidden('Удалять турниры может только администратор');

  // Мягкое удаление: история клуба не должна исчезать безвозвратно.
  await db
    .update(tournaments)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(tournaments.id, id));

  await recordAudit(db, actor, {
    action: 'tournament.deleted',
    entityType: 'tournament',
    entityId: id,
    tournamentId: id,
  });
}

async function nextWaitlistPosition(db: Database, tournamentId: string): Promise<number> {
  const [row] = await db
    .select({ value: max(tournamentPlayers.waitlistPosition) })
    .from(tournamentPlayers)
    .where(eq(tournamentPlayers.tournamentId, tournamentId));
  return (row?.value ?? 0) + 1;
}

export interface AddParticipantResult {
  participant: ParticipantDto;
  waitlisted: boolean;
}

/**
 * Параллельные турниры — в один календарный день (как бейдж «Параллельно» в списке).
 * Нельзя быть в составе сразу в двух: на площадке человек физически в одном потоке.
 */
async function assertNotInParallelTournament(
  db: Database,
  tournament: TournamentRow,
  playerId: string,
): Promise<void> {
  const day = tournament.startsAt.toISOString().slice(0, 10);
  const rows = await db
    .select({
      title: tournaments.title,
      category: tournaments.category,
      startsAt: tournaments.startsAt,
    })
    .from(tournamentPlayers)
    .innerJoin(tournaments, eq(tournaments.id, tournamentPlayers.tournamentId))
    .where(
      and(
        eq(tournamentPlayers.playerId, playerId),
        ne(tournamentPlayers.tournamentId, tournament.id),
        inArray(tournamentPlayers.status, ['registered', 'waitlisted']),
        isNull(tournaments.deletedAt),
        notInArray(tournaments.status, ['finished', 'archived']),
      ),
    );

  const conflict = rows.find((row) => row.startsAt.toISOString().slice(0, 10) === day);
  if (!conflict) return;

  const label = conflict.category
    ? `«${conflict.title}» (${conflict.category})`
    : `«${conflict.title}»`;
  throw new ApiError(
    'already_in_parallel_tournament',
    `Уже есть запись в параллельном турнире ${label}`,
    { title: conflict.title, category: conflict.category },
  );
}

export async function addParticipant(
  db: Database,
  tournamentId: string,
  playerId: string,
  actor: Viewer,
  options: { bySelf: boolean },
): Promise<AddParticipantResult> {
  const tournament = await getTournamentRow(db, tournamentId);
  if (options.bySelf) {
    if (actor.playerId !== playerId) throw forbidden('Заявиться можно только за себя');
    if (tournament.status !== 'registration') {
      throw wrongStatus('Регистрация на этот турнир закрыта');
    }
  } else if (!canManageTournaments(actor)) {
    throw forbidden('Добавлять игроков может организатор');
  } else if (isTournamentClosed(tournament.status)) {
    throw wrongStatus('Турнир уже завершён');
  }

  const [player] = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
  if (!player) throw notFound('Игрок не найден');
  if (player.mergedIntoId) {
    throw new ApiError('validation_failed', 'Эта карточка объединена с другой');
  }

  const [existing] = await db
    .select()
    .from(tournamentPlayers)
    .where(
      and(
        eq(tournamentPlayers.tournamentId, tournamentId),
        eq(tournamentPlayers.playerId, playerId),
      ),
    )
    .limit(1);

  if (existing && existing.status !== 'withdrawn') {
    return {
      participant: toParticipantDto(existing, toPlayerDto(player)),
      waitlisted: existing.status === 'waitlisted',
    };
  }

  await assertNotInParallelTournament(db, tournament, playerId);

  const counts = await loadCounts(db, tournamentId);
  const full = counts.participantCount >= tournament.maxPlayers;
  const status = full ? 'waitlisted' : 'registered';
  const waitlistPosition = full ? await nextWaitlistPosition(db, tournamentId) : null;

  const values = {
    tournamentId,
    playerId,
    status,
    waitlistPosition,
    addedBySelf: options.bySelf,
    confirmedAndPaid: false,
    updatedAt: new Date(),
  } as const;

  const row = existing
    ? (
        await db
          .update(tournamentPlayers)
          .set(values)
          .where(eq(tournamentPlayers.id, existing.id))
          .returning()
      )[0]
    : (await db.insert(tournamentPlayers).values(values).returning())[0];

  if (!row) throw new ApiError('internal', 'Не удалось добавить игрока в турнир');

  await recordAudit(db, actor, {
    action: options.bySelf ? 'participant.joined' : 'participant.added',
    entityType: 'participant',
    entityId: row.id,
    tournamentId,
    payload: { playerId, status },
  });

  return { participant: toParticipantDto(row, toPlayerDto(player)), waitlisted: full };
}

export async function removeParticipant(
  db: Database,
  tournamentId: string,
  playerId: string,
  actor: Viewer,
  options: { bySelf: boolean },
): Promise<void> {
  const tournament = await getTournamentRow(db, tournamentId);
  if (options.bySelf) {
    if (actor.playerId !== playerId) throw forbidden('Отменить можно только свою заявку');
    // Самим можно сняться, пока турнир не стартовал — и при открытой, и при
    // закрытой регистрации. После галочки подтверждения — только через организатора.
    if (tournament.status === 'running' || isTournamentClosed(tournament.status)) {
      throw wrongStatus('Турнир уже идёт, обратитесь к организатору');
    }
  } else if (!canManageTournaments(actor)) {
    throw forbidden();
  }
  if (tournament.status === 'running' || isTournamentClosed(tournament.status)) {
    throw wrongStatus('Состав уже зафиксирован расписанием');
  }

  const [existing] = await db
    .select()
    .from(tournamentPlayers)
    .where(
      and(
        eq(tournamentPlayers.tournamentId, tournamentId),
        eq(tournamentPlayers.playerId, playerId),
      ),
    )
    .limit(1);
  if (!existing) return;

  // Сам игрок может сняться, пока модератор не подтвердил участие
  // (и для самостоятельной заявки, и если добавили организатором).
  if (options.bySelf && existing.confirmedAndPaid) {
    throw wrongStatus('Участие уже подтверждено, обратитесь к организатору');
  }

  await db.delete(tournamentPlayers).where(eq(tournamentPlayers.id, existing.id));

  // Освободилось место — поднимаем первого из листа ожидания.
  if (existing.status === 'registered') {
    const [next] = await db
      .select()
      .from(tournamentPlayers)
      .where(
        and(
          eq(tournamentPlayers.tournamentId, tournamentId),
          eq(tournamentPlayers.status, 'waitlisted'),
        ),
      )
      .orderBy(asc(tournamentPlayers.waitlistPosition))
      .limit(1);
    if (next) {
      await db
        .update(tournamentPlayers)
        .set({ status: 'registered', waitlistPosition: null, updatedAt: new Date() })
        .where(eq(tournamentPlayers.id, next.id));
    }
  }

  await recordAudit(db, actor, {
    action: options.bySelf ? 'participant.left' : 'participant.removed',
    entityType: 'participant',
    entityId: existing.id,
    tournamentId,
    payload: { playerId },
  });
}

export async function setParticipantPaid(
  db: Database,
  tournamentId: string,
  playerId: string,
  confirmedAndPaid: boolean,
  actor: Viewer,
): Promise<ParticipantDto> {
  const tournament = await getTournamentRow(db, tournamentId);
  if (!canManageTournaments(actor)) throw forbidden();
  if (isTournamentClosed(tournament.status)) throw wrongStatus('Турнир уже завершён');

  const [row] = await db
    .update(tournamentPlayers)
    .set({ confirmedAndPaid, updatedAt: new Date() })
    .where(
      and(
        eq(tournamentPlayers.tournamentId, tournamentId),
        eq(tournamentPlayers.playerId, playerId),
      ),
    )
    .returning();
  if (!row) throw notFound('Заявка не найдена');

  const [player] = await db.select().from(players).where(eq(players.id, playerId)).limit(1);

  await recordAudit(db, actor, {
    action: 'participant.paid',
    entityType: 'participant',
    entityId: row.id,
    tournamentId,
    payload: { playerId, confirmedAndPaid },
  });

  return toParticipantDto(row, toPlayerDto(player as PlayerRow));
}

export async function promoteFromWaitlist(
  db: Database,
  tournamentId: string,
  playerId: string,
  actor: Viewer,
): Promise<ParticipantDto> {
  const tournament = await getTournamentRow(db, tournamentId);
  if (!canManageTournaments(actor)) throw forbidden();

  const counts = await loadCounts(db, tournamentId);
  if (counts.participantCount >= tournament.maxPlayers) {
    throw new ApiError('validation_failed', 'Свободных мест нет, увеличьте состав турнира');
  }

  const [row] = await db
    .update(tournamentPlayers)
    .set({ status: 'registered', waitlistPosition: null, updatedAt: new Date() })
    .where(
      and(
        eq(tournamentPlayers.tournamentId, tournamentId),
        eq(tournamentPlayers.playerId, playerId),
      ),
    )
    .returning();
  if (!row) throw notFound('Заявка не найдена');

  const [player] = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
  return toParticipantDto(row, toPlayerDto(player as PlayerRow));
}

export async function listParticipants(
  db: Database,
  tournamentId: string,
): Promise<{ rows: TournamentPlayerRow[]; participants: ParticipantDto[] }> {
  const joined = await db
    .select({ participant: tournamentPlayers, player: players })
    .from(tournamentPlayers)
    .innerJoin(players, eq(players.id, tournamentPlayers.playerId))
    .where(eq(tournamentPlayers.tournamentId, tournamentId))
    .orderBy(
      asc(tournamentPlayers.status),
      asc(tournamentPlayers.waitlistPosition),
      asc(tournamentPlayers.createdAt),
    );

  return {
    rows: joined.map((row) => row.participant),
    participants: joined.map((row) => toParticipantDto(row.participant, toPlayerDto(row.player))),
  };
}

export async function setRegistrationOpen(
  db: Database,
  tournamentId: string,
  open: boolean,
  actor: Viewer,
): Promise<TournamentDto> {
  const tournament = await getTournamentRow(db, tournamentId);
  if (!canManageTournaments(actor)) throw forbidden();
  if (tournament.status === 'running' || isTournamentClosed(tournament.status)) {
    throw wrongStatus('Турнир уже идёт или завершён');
  }

  await db
    .update(tournaments)
    .set({ status: open ? 'registration' : 'registration_closed', updatedAt: new Date() })
    .where(eq(tournaments.id, tournamentId));

  await recordAudit(db, actor, {
    action: open ? 'tournament.registration_reopened' : 'tournament.registration_closed',
    entityType: 'tournament',
    entityId: tournamentId,
    tournamentId,
  });

  return getTournamentDto(db, tournamentId, actor);
}

export async function finishTournament(
  db: Database,
  tournamentId: string,
  actor: Viewer,
): Promise<TournamentDto> {
  const tournament = await getTournamentRow(db, tournamentId);
  if (!canManageTournaments(actor)) throw forbidden();
  if (tournament.status !== 'running') {
    throw wrongStatus('Завершить можно только идущий турнир');
  }

  if (tournament.format === 'mexicano') {
    // Несыгранный «следующий» раунд не должен блокировать финиш: организатор
    // решает, когда хватит игр. Счёт обязателен только у начатых матчей.
    const [unscored] = await db
      .select({ total: count() })
      .from(matches)
      .where(
        and(
          eq(matches.tournamentId, tournamentId),
          isNull(matches.scoreA),
          notInArray(matches.status, ['scheduled', 'skipped']),
        ),
      );
    if (Number(unscored?.total ?? 0) > 0) {
      throw new ApiError('score_required', 'В некоторых матчах не введён счёт');
    }
    await db
      .update(matches)
      .set({ status: 'skipped', finishedAt: new Date(), updatedAt: new Date() })
      .where(
        and(eq(matches.tournamentId, tournamentId), eq(matches.status, 'scheduled')),
      );
  } else {
    const [unscored] = await db
      .select({ total: count() })
      .from(matches)
      .where(and(eq(matches.tournamentId, tournamentId), isNull(matches.scoreA)));
    if (Number(unscored?.total ?? 0) > 0) {
      // Не даём завершить турнир с пустыми матчами: таблица получилась бы неполной.
      throw new ApiError('score_required', 'В некоторых матчах не введён счёт');
    }
  }

  await db
    .update(tournaments)
    .set({ status: 'finished', finishedAt: new Date(), updatedAt: new Date() })
    .where(eq(tournaments.id, tournamentId));

  await recordAudit(db, actor, {
    action: 'tournament.finished',
    entityType: 'tournament',
    entityId: tournamentId,
    tournamentId,
  });

  return getTournamentDto(db, tournamentId, actor);
}

/** Возвращает турнир к состоянию «идёт», если завершили по ошибке. */
export async function reopenTournament(
  db: Database,
  tournamentId: string,
  actor: Viewer,
): Promise<TournamentDto> {
  const tournament = await getTournamentRow(db, tournamentId);
  if (!canManageTournaments(actor)) throw forbidden();
  if (tournament.status !== 'finished') {
    throw wrongStatus('Турнир не завершён');
  }

  await db
    .update(tournaments)
    .set({ status: 'running', finishedAt: null, updatedAt: new Date() })
    .where(eq(tournaments.id, tournamentId));

  await recordAudit(db, actor, {
    action: 'tournament.reopened',
    entityType: 'tournament',
    entityId: tournamentId,
    tournamentId,
  });

  return getTournamentDto(db, tournamentId, actor);
}

/** Скрыть завершённый турнир в архив (только админ). Обратно — unarchive. */
export async function archiveTournament(
  db: Database,
  tournamentId: string,
  actor: Viewer,
): Promise<TournamentDto> {
  const tournament = await getTournamentRow(db, tournamentId);
  if (!isAdmin(actor)) throw forbidden();
  if (tournament.status !== 'finished') {
    throw wrongStatus('В архив можно убрать только завершённый турнир');
  }

  await db
    .update(tournaments)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(eq(tournaments.id, tournamentId));

  await recordAudit(db, actor, {
    action: 'tournament.archived',
    entityType: 'tournament',
    entityId: tournamentId,
    tournamentId,
  });

  return getTournamentDto(db, tournamentId, actor);
}

/** Вернуть турнир из архива в «Завершён». */
export async function unarchiveTournament(
  db: Database,
  tournamentId: string,
  actor: Viewer,
): Promise<TournamentDto> {
  const tournament = await getTournamentRow(db, tournamentId);
  if (!isAdmin(actor)) throw forbidden();
  if (tournament.status !== 'archived') {
    throw wrongStatus('Турнир не в архиве');
  }

  await db
    .update(tournaments)
    .set({ status: 'finished', updatedAt: new Date() })
    .where(eq(tournaments.id, tournamentId));

  await recordAudit(db, actor, {
    action: 'tournament.unarchived',
    entityType: 'tournament',
    entityId: tournamentId,
    tournamentId,
  });

  return getTournamentDto(db, tournamentId, actor);
}

/**
 * Откат «идёт» → «регистрация завершена»: сносит расписание, чтобы можно было
 * заменить игрока и заново собрать игры. Только до первого начатого матча.
 */
export async function unstartTournament(
  db: Database,
  tournamentId: string,
  actor: Viewer,
): Promise<TournamentDto> {
  const tournament = await getTournamentRow(db, tournamentId);
  if (!canManageTournaments(actor)) throw forbidden();
  if (tournament.status !== 'running') {
    throw wrongStatus('Откатить можно только идущий турнир');
  }

  const [started] = await db
    .select({ total: count() })
    .from(matches)
    .where(and(eq(matches.tournamentId, tournamentId), ne(matches.status, 'scheduled')));
  if (Number(started?.total ?? 0) > 0) {
    throw wrongStatus('Откатить можно только до начала первого матча');
  }

  // Каскадом уходят матчи, составы и sit-out'ы — как при start/reshuffle.
  await db.delete(rounds).where(eq(rounds.tournamentId, tournamentId));
  await db
    .update(tournaments)
    .set({ status: 'registration_closed', updatedAt: new Date() })
    .where(eq(tournaments.id, tournamentId));

  await recordAudit(db, actor, {
    action: 'tournament.unstarted',
    entityType: 'tournament',
    entityId: tournamentId,
    tournamentId,
  });

  return getTournamentDto(db, tournamentId, actor);
}

export { loadCounts };
