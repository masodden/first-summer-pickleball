import { randomBytes } from 'node:crypto';
import { and, asc, count, desc, eq, inArray, isNull, max, ne, notInArray, sql } from 'drizzle-orm';
import {
  classicTwelvePairBracket,
  isTournamentClosed,
  normalizeCourtNames,
  parseBracketConfig,
  type BracketConfig,
  type CreateTournamentInput,
  type ParticipantDto,
  type StandingsSortKey,
  type TournamentDto,
  type TournamentFormat,
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
import { toParticipantDto, toPlayerDto, attachPartners } from './mappers.js';
import { canManageTournaments, isAdmin, type Viewer } from '../auth/context.js';
import { recordAudit } from './audit.js';
import { healMergedPartnerLinks } from './players.js';

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

function bracketConfigForRow(row: TournamentRow): BracketConfig | null {
  return parseBracketConfig(row.format, row.bracketConfig, row.pointsToWin);
}

function bracketConfigToStore(
  format: TournamentFormat,
  input: BracketConfig | null | undefined,
  pointsToWin: number,
  current: unknown = null,
): BracketConfig | null {
  if (format !== 'fixed_pairs') return null;
  if (input) return input;
  const parsed = parseBracketConfig(format, current, pointsToWin);
  return parsed ?? classicTwelvePairBracket();
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
    standingsSort: row.standingsSort as StandingsSortKey[],
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
    ratingBalance: row.ratingBalance,
    entryFee: row.entryFee,
    roundsGenerated: counts.roundsGenerated,
    updatedAt: row.updatedAt.toISOString(),
    canManage: canManageTournaments(viewer),
    canDelete: isAdmin(viewer),
    myParticipation,
    bracketConfig: bracketConfigForRow(row),
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
  const [dto] = attachPartners([
    { participant: row.participant, player: toPlayerDto(row.player) },
  ]);
  if (!dto) return null;
  if (!row.participant.partnerPlayerId) return dto;

  const [partnerJoin] = await db
    .select({ participant: tournamentPlayers, player: players })
    .from(tournamentPlayers)
    .innerJoin(players, eq(players.id, tournamentPlayers.playerId))
    .where(
      and(
        eq(tournamentPlayers.tournamentId, tournamentId),
        eq(tournamentPlayers.playerId, row.participant.partnerPlayerId),
      ),
    )
    .limit(1);
  if (!partnerJoin) return dto;
  return attachPartners([
    { participant: row.participant, player: toPlayerDto(row.player) },
    { participant: partnerJoin.participant, player: toPlayerDto(partnerJoin.player) },
  ])[0] ?? dto;
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
      tieRule: input.tieRule ?? 'golden_point',
      standingsSort: input.standingsSort ?? ['wins', 'points', 'diff'],
      ratingBalance: input.format === 'fixed_pairs' ? false : (input.ratingBalance ?? true),
      entryFee: input.entryFee ?? null,
      description: input.description ?? null,
      formatDescription: input.formatDescription ?? null,
      venueName: input.venueName ?? null,
      venueAddress: input.venueAddress ?? null,
      venueMapUrl: input.venueMapUrl ?? null,
      publicSlug: createSlug(),
      createdByAccountId: actor.accountId,
      bracketConfig: bracketConfigToStore(input.format, input.bracketConfig, input.pointsToWin),
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

  const nextFormat = input.format ?? current.format;
  const nextPoints = input.pointsToWin ?? current.pointsToWin;
  if (input.bracketConfig !== undefined || input.format !== undefined) {
    patch.bracketConfig = bracketConfigToStore(
      nextFormat,
      input.bracketConfig,
      nextPoints,
      current.bracketConfig,
    );
  }

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

/** После promote/remove позиции листа ожидания снова 1…n. */
async function renumberWaitlist(db: Database, tournamentId: string): Promise<void> {
  const rows = await db
    .select({ id: tournamentPlayers.id })
    .from(tournamentPlayers)
    .where(
      and(
        eq(tournamentPlayers.tournamentId, tournamentId),
        eq(tournamentPlayers.status, 'waitlisted'),
      ),
    )
    .orderBy(asc(tournamentPlayers.waitlistPosition), asc(tournamentPlayers.createdAt));

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (!row) continue;
    await db
      .update(tournamentPlayers)
      .set({ waitlistPosition: index + 1, updatedAt: new Date() })
      .where(eq(tournamentPlayers.id, row.id));
  }
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
): Promise<{ status: string } | null> {
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
  if (!existing) return null;

  // Сам игрок может сняться, пока модератор не подтвердил участие
  // (и для самостоятельной заявки, и если добавили организатором).
  if (options.bySelf && existing.confirmedAndPaid) {
    throw wrongStatus('Участие уже подтверждено, обратитесь к организатору');
  }

  await db.delete(tournamentPlayers).where(eq(tournamentPlayers.id, existing.id));
  if (existing.partnerPlayerId) {
    await clearPartnerLink(db, tournamentId, existing.playerId, existing.partnerPlayerId);
  }

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

  if (existing.status === 'waitlisted' || existing.status === 'registered') {
    await renumberWaitlist(db, tournamentId);
  }

  await recordAudit(db, actor, {
    action: options.bySelf ? 'participant.left' : 'participant.removed',
    entityType: 'participant',
    entityId: existing.id,
    tournamentId,
    payload: { playerId },
  });

  return { status: existing.status };
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
  if (tournament.status !== 'registration' && tournament.status !== 'registration_closed') {
    throw wrongStatus('Подтверждение оплаты доступно до старта игр');
  }

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

  await recordAudit(db, actor, {
    action: 'participant.paid',
    entityType: 'participant',
    entityId: row.id,
    tournamentId,
    payload: { playerId, confirmedAndPaid },
  });

  const { participants } = await listParticipants(db, tournamentId);
  const dto = participants.find((item) => item.player.id === playerId);
  if (!dto) throw notFound('Заявка не найдена');
  return dto;
}

export async function promoteFromWaitlist(
  db: Database,
  tournamentId: string,
  playerId: string,
  actor: Viewer,
  options: { replacePlayerId?: string } = {},
): Promise<ParticipantDto> {
  const tournament = await getTournamentRow(db, tournamentId);
  if (!canManageTournaments(actor)) throw forbidden();

  const replacePlayerId = options.replacePlayerId;

  const [waitlisted] = await db
    .select()
    .from(tournamentPlayers)
    .where(
      and(
        eq(tournamentPlayers.tournamentId, tournamentId),
        eq(tournamentPlayers.playerId, playerId),
        eq(tournamentPlayers.status, 'waitlisted'),
      ),
    )
    .limit(1);
  if (!waitlisted) throw notFound('Игрок не в листе ожидания');

  if (replacePlayerId) {
    if (replacePlayerId === playerId) {
      throw new ApiError('validation_failed', 'Нельзя заменить игрока самим собой');
    }
    if (tournament.status === 'running' || isTournamentClosed(tournament.status)) {
      throw wrongStatus('Состав уже зафиксирован расписанием');
    }

    const [outgoing] = await db
      .select()
      .from(tournamentPlayers)
      .where(
        and(
          eq(tournamentPlayers.tournamentId, tournamentId),
          eq(tournamentPlayers.playerId, replacePlayerId),
          eq(tournamentPlayers.status, 'registered'),
        ),
      )
      .limit(1);
    if (!outgoing) throw notFound('Игрок для замены не найден в составе');

    await db.transaction(async (tx) => {
      if (outgoing.partnerPlayerId) {
        await tx
          .update(tournamentPlayers)
          .set({ partnerPlayerId: null, updatedAt: new Date() })
          .where(
            and(
              eq(tournamentPlayers.tournamentId, tournamentId),
              eq(tournamentPlayers.playerId, outgoing.partnerPlayerId),
            ),
          );
      }
      await tx.delete(tournamentPlayers).where(eq(tournamentPlayers.id, outgoing.id));
      await tx
        .update(tournamentPlayers)
        .set({ status: 'registered', waitlistPosition: null, updatedAt: new Date() })
        .where(eq(tournamentPlayers.id, waitlisted.id));
    });

    await recordAudit(db, actor, {
      action: 'participant.replaced',
      entityType: 'participant',
      entityId: waitlisted.id,
      tournamentId,
      payload: { promotedPlayerId: playerId, replacedPlayerId: replacePlayerId },
    });
  } else {
    const counts = await loadCounts(db, tournamentId);
    if (counts.participantCount >= tournament.maxPlayers) {
      throw new ApiError(
        'validation_failed',
        'Свободных мест нет — выберите, кого заменить из состава',
      );
    }

    await db
      .update(tournamentPlayers)
      .set({ status: 'registered', waitlistPosition: null, updatedAt: new Date() })
      .where(eq(tournamentPlayers.id, waitlisted.id));
  }

  await renumberWaitlist(db, tournamentId);

  const [player] = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
  const [row] = await db
    .select()
    .from(tournamentPlayers)
    .where(
      and(
        eq(tournamentPlayers.tournamentId, tournamentId),
        eq(tournamentPlayers.playerId, playerId),
      ),
    )
    .limit(1);
  if (!row || !player) throw notFound('Заявка не найдена');
  return toParticipantDto(row, toPlayerDto(player));
}

export async function listParticipants(
  db: Database,
  tournamentId: string,
): Promise<{ rows: TournamentPlayerRow[]; participants: ParticipantDto[] }> {
  const load = async () => {
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
      items: joined.map((row) => ({
        participant: row.participant,
        player: toPlayerDto(row.player),
      })),
    };
  };

  let snapshot = await load();
  const byId = new Map(snapshot.rows.map((row) => [row.playerId, row]));
  const brokenLink = snapshot.rows.some((row) => {
    const partnerId = row.partnerPlayerId;
    if (!partnerId) return false;
    const partner = byId.get(partnerId);
    return !partner || partner.partnerPlayerId !== row.playerId;
  });
  if (brokenLink && (await healMergedPartnerLinks(db, tournamentId))) {
    snapshot = await load();
  }

  return {
    rows: snapshot.rows,
    participants: attachPartners(snapshot.items),
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
    // Пропущенный раунд — как будто его не было: счёт не нужен.
    // Неначатые (scheduled) по-прежнему блокируют: их надо явно пропустить,
    // чтобы случайно не закрыть идущий americano с хвостом расписания.
    const [unscored] = await db
      .select({ total: count() })
      .from(matches)
      .where(
        and(
          eq(matches.tournamentId, tournamentId),
          isNull(matches.scoreA),
          ne(matches.status, 'skipped'),
        ),
      );
    if (Number(unscored?.total ?? 0) > 0) {
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

export async function clearPartnerLink(
  db: Database,
  tournamentId: string,
  playerId: string,
  partnerPlayerId: string,
): Promise<void> {
  await db
    .update(tournamentPlayers)
    .set({ partnerPlayerId: null, updatedAt: new Date() })
    .where(
      and(
        eq(tournamentPlayers.tournamentId, tournamentId),
        eq(tournamentPlayers.playerId, partnerPlayerId),
        eq(tournamentPlayers.partnerPlayerId, playerId),
      ),
    );
}
