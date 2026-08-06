import { and, asc, count, desc, eq, inArray, isNull, max, sql } from 'drizzle-orm';import {
  isTrainingActive,
  trainingCourtHours,
  trainingSuggestedShare,
  type CreateTrainingInput,
  type TrainingCourtBlockDto,
  type TrainingDto,
  type TrainingParticipantDto,
  type TrainingStateDto,
  type TrainingSummaryDto,
  type UpdateTrainingInput,
} from '@fsp/shared';
import type { Database } from '../db/index.js';
import {
  players,
  trainingCourtBlocks,
  trainingPlayers,
  trainings,
  type PlayerRow,
  type TrainingCourtBlockRow,
  type TrainingPlayerRow,
  type TrainingRow,
} from '../db/schema.js';
import { ApiError, forbidden, notFound, wrongStatus } from '../lib/errors.js';
import { toPlayerDto } from './mappers.js';
import { canManageTrainings, isAdmin, type Viewer } from '../auth/context.js';
import { recordAudit } from './audit.js';

interface TrainingCounts {
  participantCount: number;
  confirmedCount: number;
}

export async function getTrainingRow(db: Database, id: string): Promise<TrainingRow> {
  const [row] = await db
    .select()
    .from(trainings)
    .where(and(eq(trainings.id, id), isNull(trainings.deletedAt)))
    .limit(1);
  if (!row) throw notFound('Тренировка не найдена');
  return row;
}

async function loadCounts(db: Database, trainingId: string): Promise<TrainingCounts> {
  const [row] = await db
    .select({
      total: count(),
      confirmed: sql<number>`count(*) filter (where ${trainingPlayers.confirmedAndPaid})`.mapWith(
        Number,
      ),
    })
    .from(trainingPlayers)
    .where(
      and(eq(trainingPlayers.trainingId, trainingId), eq(trainingPlayers.status, 'registered')),
    );
  return {
    participantCount: Number(row?.total ?? 0),
    confirmedCount: Number(row?.confirmed ?? 0),
  };
}

async function loadBlocks(
  db: Database,
  trainingId: string,
): Promise<TrainingCourtBlockRow[]> {
  return db
    .select()
    .from(trainingCourtBlocks)
    .where(eq(trainingCourtBlocks.trainingId, trainingId))
    .orderBy(asc(trainingCourtBlocks.sortIndex));
}

function toBlockDtos(rows: TrainingCourtBlockRow[]): TrainingCourtBlockDto[] {
  return rows.map((row) => ({
    sortIndex: row.sortIndex,
    courts: row.courts,
    hours: Number(row.hours),
  }));
}

function moneyFromBlocks(
  blocks: TrainingCourtBlockDto[],
  pricePerCourtHour: number,
): { courtHours: number; totalCost: number } {
  const courtHours = trainingCourtHours(blocks);
  return { courtHours, totalCost: Math.round(courtHours * pricePerCourtHour) };
}

function toTrainingParticipantDto(
  row: TrainingPlayerRow,
  player: PlayerDtoLike,
  suggestedAmount: number,
): TrainingParticipantDto {
  const amountDue = row.amountDue;
  return {
    id: row.id,
    player,
    status: row.status,
    confirmedAndPaid: row.confirmedAndPaid,
    waitlistPosition: row.waitlistPosition,
    addedBySelf: row.addedBySelf,
    amountDue,
    suggestedAmount,
    amount: amountDue ?? suggestedAmount,
    createdAt: row.createdAt.toISOString(),
  };
}

type PlayerDtoLike = ReturnType<typeof toPlayerDto>;

function toSummaryDto(
  row: TrainingRow,
  counts: TrainingCounts,
  blocks: TrainingCourtBlockDto[],
): TrainingSummaryDto {
  const { courtHours, totalCost } = moneyFromBlocks(blocks, row.pricePerCourtHour);
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    startsAt: row.startsAt.toISOString(),
    venueName: row.venueName,
    maxPlayers: row.maxPlayers,
    pricePerCourtHour: row.pricePerCourtHour,
    courtHours,
    totalCost,
    participantCount: counts.participantCount,
    confirmedCount: counts.confirmedCount,
    courtBlocks: blocks,
    createdAt: row.createdAt.toISOString(),
  };
}

function toTrainingDto(
  row: TrainingRow,
  counts: TrainingCounts,
  blocks: TrainingCourtBlockDto[],
  viewer: Viewer | null,
  myParticipation: TrainingParticipantDto | null,
): TrainingDto {
  const allConfirmed =
    counts.participantCount > 0 && counts.confirmedCount === counts.participantCount;
  return {
    ...toSummaryDto(row, counts, blocks),
    description: row.description,
    venueAddress: row.venueAddress,
    venueMapUrl: row.venueMapUrl,
    updatedAt: row.updatedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    canManage: canManageTrainings(viewer),
    canDelete: isAdmin(viewer),
    allConfirmed,
    myParticipation,
  };
}

async function replaceBlocks(
  db: Database,
  trainingId: string,
  blocks: CreateTrainingInput['courtBlocks'],
): Promise<void> {
  await db.delete(trainingCourtBlocks).where(eq(trainingCourtBlocks.trainingId, trainingId));
  if (blocks.length === 0) return;
  await db.insert(trainingCourtBlocks).values(
    blocks.map((block, index) => ({
      trainingId,
      sortIndex: index,
      courts: block.courts,
      hours: block.hours,
    })),
  );
}

async function findParticipation(
  db: Database,
  trainingId: string,
  playerId: string | null,
  suggestedAmount: number,
): Promise<TrainingParticipantDto | null> {
  if (!playerId) return null;
  const [joined] = await db
    .select({ participant: trainingPlayers, player: players })
    .from(trainingPlayers)
    .innerJoin(players, eq(players.id, trainingPlayers.playerId))
    .where(
      and(eq(trainingPlayers.trainingId, trainingId), eq(trainingPlayers.playerId, playerId)),
    )
    .limit(1);
  if (!joined) return null;
  return toTrainingParticipantDto(
    joined.participant,
    toPlayerDto(joined.player),
    suggestedAmount,
  );
}

export async function listTrainings(
  db: Database,
  _viewer: Viewer | null,
): Promise<TrainingSummaryDto[]> {
  const rows = await db
    .select()
    .from(trainings)
    .where(isNull(trainings.deletedAt))
    .orderBy(
      sql`case ${trainings.status}
        when 'running' then 0
        when 'finished' then 2
        else 1
      end`,
      sql`case when ${trainings.status} = 'finished' then ${trainings.startsAt} end desc nulls last`,
      sql`case when ${trainings.status} <> 'finished' then ${trainings.startsAt} end asc nulls last`,
      desc(trainings.createdAt),
    );

  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const participantRows = await db
    .select({
      trainingId: trainingPlayers.trainingId,
      participantCount: sql<number>`count(*)`.mapWith(Number),
      confirmedCount: sql<number>`count(*) filter (where ${trainingPlayers.confirmedAndPaid})`.mapWith(
        Number,
      ),
    })
    .from(trainingPlayers)
    .where(
      and(inArray(trainingPlayers.trainingId, ids), eq(trainingPlayers.status, 'registered')),
    )
    .groupBy(trainingPlayers.trainingId);

  const blockRows = await db
    .select()
    .from(trainingCourtBlocks)
    .where(inArray(trainingCourtBlocks.trainingId, ids))
    .orderBy(asc(trainingCourtBlocks.sortIndex));

  const countsById = new Map(
    participantRows.map((row) => [
      row.trainingId,
      { participantCount: row.participantCount, confirmedCount: row.confirmedCount },
    ]),
  );
  const blocksById = new Map<string, TrainingCourtBlockDto[]>();
  for (const block of blockRows) {
    const list = blocksById.get(block.trainingId) ?? [];
    list.push({ sortIndex: block.sortIndex, courts: block.courts, hours: Number(block.hours) });
    blocksById.set(block.trainingId, list);
  }

  return rows.map((row) =>
    toSummaryDto(
      row,
      countsById.get(row.id) ?? { participantCount: 0, confirmedCount: 0 },
      blocksById.get(row.id) ?? [],
    ),
  );
}

export async function getTrainingDto(
  db: Database,
  id: string,
  viewer: Viewer | null,
): Promise<TrainingDto> {
  const row = await getTrainingRow(db, id);
  const counts = await loadCounts(db, id);
  const blocks = toBlockDtos(await loadBlocks(db, id));
  const { totalCost } = moneyFromBlocks(blocks, row.pricePerCourtHour);
  const suggested = trainingSuggestedShare(totalCost, counts.participantCount);
  const participation = await findParticipation(db, id, viewer?.playerId ?? null, suggested);
  return toTrainingDto(row, counts, blocks, viewer, participation);
}

export async function getTrainingState(
  db: Database,
  id: string,
  viewer: Viewer | null,
): Promise<TrainingStateDto> {
  const training = await getTrainingDto(db, id, viewer);
  const participants = await listTrainingParticipants(db, id);
  return { training, participants };
}

export async function createTraining(
  db: Database,
  input: CreateTrainingInput,
  actor: Viewer,
): Promise<TrainingDto> {
  if (!canManageTrainings(actor)) throw forbidden('Создавать тренировки может организатор');

  const now = new Date();
  const [row] = await db
    .insert(trainings)
    .values({
      title: input.title,
      status: 'running',
      startsAt: new Date(input.startsAt),
      maxPlayers: input.maxPlayers ?? null,
      pricePerCourtHour: input.pricePerCourtHour,
      description: input.description ?? null,
      venueName: input.venueName ?? null,
      venueAddress: input.venueAddress ?? null,
      venueMapUrl: input.venueMapUrl ?? null,
      createdByAccountId: actor.accountId,
      startedAt: now,
    })
    .returning();

  if (!row) throw new ApiError('internal', 'Не удалось создать тренировку');

  await replaceBlocks(db, row.id, input.courtBlocks);

  await recordAudit(db, actor, {
    action: 'training.created',
    entityType: 'training',
    entityId: row.id,
    payload: { title: row.title },
  });

  return getTrainingDto(db, row.id, actor);
}

export async function updateTraining(
  db: Database,
  id: string,
  input: UpdateTrainingInput,
  actor: Viewer,
): Promise<TrainingDto> {
  const current = await getTrainingRow(db, id);
  if (!canManageTrainings(actor)) throw forbidden();
  if (!isTrainingActive(current.status)) {
    throw wrongStatus('Завершённую тренировку изменить нельзя');
  }

  const patch: Partial<typeof trainings.$inferInsert> = { updatedAt: new Date() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.startsAt !== undefined) patch.startsAt = new Date(input.startsAt);
  if (input.maxPlayers !== undefined) patch.maxPlayers = input.maxPlayers;
  if (input.pricePerCourtHour !== undefined) patch.pricePerCourtHour = input.pricePerCourtHour;
  if (input.description !== undefined) patch.description = input.description;
  if (input.venueName !== undefined) patch.venueName = input.venueName;
  if (input.venueAddress !== undefined) patch.venueAddress = input.venueAddress;
  if (input.venueMapUrl !== undefined) patch.venueMapUrl = input.venueMapUrl;

  await db.update(trainings).set(patch).where(eq(trainings.id, id));

  if (input.courtBlocks !== undefined) {
    await replaceBlocks(db, id, input.courtBlocks);
  }

  await recordAudit(db, actor, {
    action: 'training.updated',
    entityType: 'training',
    entityId: id,
    payload: { fields: Object.keys(input) },
  });

  return getTrainingDto(db, id, actor);
}

export async function deleteTraining(db: Database, id: string, actor: Viewer): Promise<void> {
  await getTrainingRow(db, id);
  if (!isAdmin(actor)) throw forbidden('Удалять тренировки может только администратор');

  await db
    .update(trainings)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(trainings.id, id));

  await recordAudit(db, actor, {
    action: 'training.deleted',
    entityType: 'training',
    entityId: id,
  });
}

async function nextWaitlistPosition(db: Database, trainingId: string): Promise<number> {
  const [row] = await db
    .select({ value: max(trainingPlayers.waitlistPosition) })
    .from(trainingPlayers)
    .where(eq(trainingPlayers.trainingId, trainingId));
  return (row?.value ?? 0) + 1;
}

export async function addTrainingParticipant(
  db: Database,
  trainingId: string,
  playerId: string,
  actor: Viewer,
  options: { bySelf: boolean },
): Promise<{ participant: TrainingParticipantDto; waitlisted: boolean }> {
  const training = await getTrainingRow(db, trainingId);
  if (options.bySelf) {
    if (actor.playerId !== playerId) throw forbidden('Записаться можно только за себя');
    if (!isTrainingActive(training.status)) {
      throw wrongStatus('Запись на эту тренировку закрыта');
    }
  } else if (!canManageTrainings(actor)) {
    throw forbidden('Добавлять игроков может организатор');
  } else if (!isTrainingActive(training.status)) {
    throw wrongStatus('Тренировка уже завершена');
  }

  const [player] = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
  if (!player) throw notFound('Игрок не найден');
  if (player.mergedIntoId) {
    throw new ApiError('validation_failed', 'Эта карточка объединена с другой');
  }

  const [existing] = await db
    .select()
    .from(trainingPlayers)
    .where(
      and(eq(trainingPlayers.trainingId, trainingId), eq(trainingPlayers.playerId, playerId)),
    )
    .limit(1);

  const blocks = toBlockDtos(await loadBlocks(db, trainingId));
  const { totalCost } = moneyFromBlocks(blocks, training.pricePerCourtHour);

  if (existing && existing.status !== 'withdrawn') {
    const counts = await loadCounts(db, trainingId);
    const suggested = trainingSuggestedShare(totalCost, counts.participantCount);
    return {
      participant: toTrainingParticipantDto(existing, toPlayerDto(player), suggested),
      waitlisted: existing.status === 'waitlisted',
    };
  }

  const counts = await loadCounts(db, trainingId);
  const full =
    training.maxPlayers !== null && counts.participantCount >= training.maxPlayers;
  const status = full ? 'waitlisted' : 'registered';
  const waitlistPosition = full ? await nextWaitlistPosition(db, trainingId) : null;

  const values = {
    trainingId,
    playerId,
    status,
    waitlistPosition,
    addedBySelf: options.bySelf,
    confirmedAndPaid: false,
    amountDue: null,
    updatedAt: new Date(),
  } as const;

  const row = existing
    ? (
        await db
          .update(trainingPlayers)
          .set(values)
          .where(eq(trainingPlayers.id, existing.id))
          .returning()
      )[0]
    : (await db.insert(trainingPlayers).values(values).returning())[0];

  if (!row) throw new ApiError('internal', 'Не удалось добавить игрока');

  const nextCounts = await loadCounts(db, trainingId);
  const suggested = trainingSuggestedShare(totalCost, nextCounts.participantCount);

  await recordAudit(db, actor, {
    action: options.bySelf ? 'training.participant.joined' : 'training.participant.added',
    entityType: 'training_participant',
    entityId: row.id,
    payload: { trainingId, playerId, status },
  });

  return {
    participant: toTrainingParticipantDto(row, toPlayerDto(player), suggested),
    waitlisted: full,
  };
}

export async function removeTrainingParticipant(
  db: Database,
  trainingId: string,
  playerId: string,
  actor: Viewer,
  options: { bySelf: boolean },
): Promise<void> {
  const training = await getTrainingRow(db, trainingId);
  if (options.bySelf) {
    if (actor.playerId !== playerId) throw forbidden('Отменить можно только свою запись');
    if (!isTrainingActive(training.status)) {
      throw wrongStatus('Тренировка уже завершена, обратитесь к организатору');
    }
  } else if (!canManageTrainings(actor)) {
    throw forbidden();
  }
  if (!isTrainingActive(training.status)) {
    throw wrongStatus('Состав завершённой тренировки менять нельзя');
  }

  const [existing] = await db
    .select()
    .from(trainingPlayers)
    .where(
      and(eq(trainingPlayers.trainingId, trainingId), eq(trainingPlayers.playerId, playerId)),
    )
    .limit(1);
  if (!existing) return;

  if (options.bySelf && existing.confirmedAndPaid) {
    throw wrongStatus('Участие уже подтверждено, обратитесь к организатору');
  }

  await db.delete(trainingPlayers).where(eq(trainingPlayers.id, existing.id));

  if (existing.status === 'registered') {
    const [next] = await db
      .select()
      .from(trainingPlayers)
      .where(
        and(
          eq(trainingPlayers.trainingId, trainingId),
          eq(trainingPlayers.status, 'waitlisted'),
        ),
      )
      .orderBy(asc(trainingPlayers.waitlistPosition))
      .limit(1);
    if (next) {
      await db
        .update(trainingPlayers)
        .set({ status: 'registered', waitlistPosition: null, updatedAt: new Date() })
        .where(eq(trainingPlayers.id, next.id));
    }
  }

  await recordAudit(db, actor, {
    action: options.bySelf ? 'training.participant.left' : 'training.participant.removed',
    entityType: 'training_participant',
    entityId: existing.id,
    payload: { trainingId, playerId },
  });
}

export async function setTrainingParticipantPaid(
  db: Database,
  trainingId: string,
  playerId: string,
  confirmedAndPaid: boolean,
  actor: Viewer,
): Promise<TrainingParticipantDto> {
  const training = await getTrainingRow(db, trainingId);
  if (!canManageTrainings(actor)) throw forbidden();
  if (training.status === 'finished') throw wrongStatus('Тренировка уже завершена');

  const [row] = await db
    .update(trainingPlayers)
    .set({ confirmedAndPaid, updatedAt: new Date() })
    .where(
      and(eq(trainingPlayers.trainingId, trainingId), eq(trainingPlayers.playerId, playerId)),
    )
    .returning();
  if (!row) throw notFound('Заявка не найдена');

  const [player] = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
  const counts = await loadCounts(db, trainingId);
  const blocks = toBlockDtos(await loadBlocks(db, trainingId));
  const { totalCost } = moneyFromBlocks(blocks, training.pricePerCourtHour);
  const suggested = trainingSuggestedShare(totalCost, counts.participantCount);

  await recordAudit(db, actor, {
    action: 'training.participant.paid',
    entityType: 'training_participant',
    entityId: row.id,
    payload: { trainingId, playerId, confirmedAndPaid },
  });

  return toTrainingParticipantDto(row, toPlayerDto(player as PlayerRow), suggested);
}

export async function setTrainingParticipantAmount(
  db: Database,
  trainingId: string,
  playerId: string,
  amountDue: number | null,
  actor: Viewer,
): Promise<TrainingParticipantDto> {
  const training = await getTrainingRow(db, trainingId);
  if (!canManageTrainings(actor)) throw forbidden();
  if (!isTrainingActive(training.status)) {
    throw wrongStatus('После завершения суммы менять нельзя');
  }

  const [row] = await db
    .update(trainingPlayers)
    .set({ amountDue, updatedAt: new Date() })
    .where(
      and(eq(trainingPlayers.trainingId, trainingId), eq(trainingPlayers.playerId, playerId)),
    )
    .returning();
  if (!row) throw notFound('Заявка не найдена');

  const [player] = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
  const counts = await loadCounts(db, trainingId);
  const blocks = toBlockDtos(await loadBlocks(db, trainingId));
  const { totalCost } = moneyFromBlocks(blocks, training.pricePerCourtHour);
  const suggested = trainingSuggestedShare(totalCost, counts.participantCount);

  await recordAudit(db, actor, {
    action: 'training.participant.amount',
    entityType: 'training_participant',
    entityId: row.id,
    payload: { trainingId, playerId, amountDue },
  });

  return toTrainingParticipantDto(row, toPlayerDto(player as PlayerRow), suggested);
}

export async function promoteTrainingFromWaitlist(
  db: Database,
  trainingId: string,
  playerId: string,
  actor: Viewer,
): Promise<TrainingParticipantDto> {
  const training = await getTrainingRow(db, trainingId);
  if (!canManageTrainings(actor)) throw forbidden();
  if (!isTrainingActive(training.status)) {
    throw wrongStatus('Тренировка уже завершена');
  }

  const counts = await loadCounts(db, trainingId);
  if (training.maxPlayers !== null && counts.participantCount >= training.maxPlayers) {
    throw new ApiError('validation_failed', 'Свободных мест нет, увеличьте лимит');
  }

  const [row] = await db
    .update(trainingPlayers)
    .set({ status: 'registered', waitlistPosition: null, updatedAt: new Date() })
    .where(
      and(eq(trainingPlayers.trainingId, trainingId), eq(trainingPlayers.playerId, playerId)),
    )
    .returning();
  if (!row) throw notFound('Заявка не найдена');

  const [player] = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
  const nextCounts = await loadCounts(db, trainingId);
  const blocks = toBlockDtos(await loadBlocks(db, trainingId));
  const { totalCost } = moneyFromBlocks(blocks, training.pricePerCourtHour);
  const suggested = trainingSuggestedShare(totalCost, nextCounts.participantCount);
  return toTrainingParticipantDto(row, toPlayerDto(player as PlayerRow), suggested);
}

export async function listTrainingParticipants(
  db: Database,
  trainingId: string,
): Promise<TrainingParticipantDto[]> {
  const training = await getTrainingRow(db, trainingId);
  const counts = await loadCounts(db, trainingId);
  const blocks = toBlockDtos(await loadBlocks(db, trainingId));
  const { totalCost } = moneyFromBlocks(blocks, training.pricePerCourtHour);
  const suggested = trainingSuggestedShare(totalCost, counts.participantCount);

  const joined = await db
    .select({ participant: trainingPlayers, player: players })
    .from(trainingPlayers)
    .innerJoin(players, eq(players.id, trainingPlayers.playerId))
    .where(eq(trainingPlayers.trainingId, trainingId))
    .orderBy(
      asc(trainingPlayers.status),
      asc(trainingPlayers.waitlistPosition),
      asc(trainingPlayers.createdAt),
    );

  return joined.map((row) =>
    toTrainingParticipantDto(row.participant, toPlayerDto(row.player), suggested),
  );
}

export async function finishTraining(
  db: Database,
  trainingId: string,
  actor: Viewer,
): Promise<TrainingDto> {
  const training = await getTrainingRow(db, trainingId);
  if (!canManageTrainings(actor)) throw forbidden();
  if (!isTrainingActive(training.status)) {
    throw wrongStatus('Тренировка уже завершена');
  }

  const counts = await loadCounts(db, trainingId);
  if (counts.participantCount < 1) {
    throw new ApiError('not_enough_players', 'Нужен хотя бы один записавшийся игрок');
  }
  if (counts.confirmedCount !== counts.participantCount) {
    throw new ApiError('not_all_confirmed', 'Не все записавшиеся подтверждены');
  }

  await db
    .update(trainings)
    .set({ status: 'finished', finishedAt: new Date(), updatedAt: new Date() })
    .where(eq(trainings.id, trainingId));

  await recordAudit(db, actor, {
    action: 'training.finished',
    entityType: 'training',
    entityId: trainingId,
  });

  return getTrainingDto(db, trainingId, actor);
}
