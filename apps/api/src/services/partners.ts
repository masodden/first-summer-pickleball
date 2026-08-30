import { and, eq } from 'drizzle-orm';
import { isFixedPairsFormat, type ParticipantDto } from '@fsp/shared';
import type { Database } from '../db/index.js';
import { players, tournamentPlayers } from '../db/schema.js';
import { ApiError, forbidden, notFound, wrongStatus } from '../lib/errors.js';
import { canManageTournaments, type Viewer } from '../auth/context.js';
import { recordAudit } from './audit.js';
import { attachPartners, toPlayerDto } from './mappers.js';
import {
  addParticipant,
  clearPartnerLink,
  getTournamentRow,
  listParticipants,
} from './tournaments.js';

async function participantDto(
  db: Database,
  tournamentId: string,
  playerId: string,
): Promise<ParticipantDto> {
  const { participants } = await listParticipants(db, tournamentId);
  const row = participants.find((item) => item.player.id === playerId);
  if (!row) throw notFound('Заявка не найдена');
  return row;
}

function bothPaidLocked(
  leftPaid: boolean,
  rightPaid: boolean,
  leftPartner: string | null,
  rightPartner: string | null,
  leftId: string,
  rightId: string,
): boolean {
  return (
    leftPaid &&
    rightPaid &&
    leftPartner === rightId &&
    rightPartner === leftId
  );
}

/**
 * Связать двух игроков. Если вызывающий ещё не в турнире — join + link.
 * Лист ожидания не связываем: второй занимает слот, иначе остаётся без пары.
 */
export async function linkPartner(
  db: Database,
  tournamentId: string,
  playerId: string,
  partnerPlayerId: string,
  actor: Viewer,
): Promise<ParticipantDto> {
  const tournament = await getTournamentRow(db, tournamentId);
  if (!isFixedPairsFormat(tournament.format)) {
    throw new ApiError('validation_failed', 'Пары есть только в формате фиксированных пар');
  }
  if (tournament.status !== 'registration' && tournament.status !== 'registration_closed') {
    throw wrongStatus('Связывать пары можно до старта турнира');
  }
  if (playerId === partnerPlayerId) {
    throw new ApiError('validation_failed', 'Нельзя связать игрока с самим собой');
  }

  const isOrganizer = canManageTournaments(actor);
  const isSelf = actor.playerId === playerId || actor.playerId === partnerPlayerId;
  if (!isOrganizer && !isSelf) throw forbidden('Связать пару можно за себя');

  const [anchor] = await db
    .select()
    .from(tournamentPlayers)
    .where(
      and(eq(tournamentPlayers.tournamentId, tournamentId), eq(tournamentPlayers.playerId, playerId)),
    )
    .limit(1);
  if (!anchor || anchor.status !== 'registered') {
    throw notFound('Игрок не в составе турнира');
  }

  let [partnerRow] = await db
    .select()
    .from(tournamentPlayers)
    .where(
      and(
        eq(tournamentPlayers.tournamentId, tournamentId),
        eq(tournamentPlayers.playerId, partnerPlayerId),
      ),
    )
    .limit(1);

  if (!partnerRow) {
    const joiningSelf = actor.playerId === partnerPlayerId;
    if (!joiningSelf) {
      throw new ApiError('validation_failed', 'Партнёр ещё не заявлен — сначала добавьте его в состав');
    }
    const joined = await addParticipant(db, tournamentId, partnerPlayerId, actor, { bySelf: true });
    if (joined.waitlisted) {
      return joined.participant;
    }
    const [created] = await db
      .select()
      .from(tournamentPlayers)
      .where(
        and(
          eq(tournamentPlayers.tournamentId, tournamentId),
          eq(tournamentPlayers.playerId, partnerPlayerId),
        ),
      )
      .limit(1);
    partnerRow = created;
  }

  if (!partnerRow || partnerRow.status !== 'registered') {
    throw new ApiError('validation_failed', 'Партнёр в листе ожидания — связка недоступна');
  }

  if (anchor.partnerPlayerId && anchor.partnerPlayerId !== partnerPlayerId) {
    throw new ApiError('validation_failed', 'У игрока уже есть партнёр');
  }
  if (partnerRow.partnerPlayerId && partnerRow.partnerPlayerId !== playerId) {
    throw new ApiError('validation_failed', 'У партнёра уже есть пара');
  }

  const now = new Date();
  await db
    .update(tournamentPlayers)
    .set({ partnerPlayerId, updatedAt: now })
    .where(eq(tournamentPlayers.id, anchor.id));
  await db
    .update(tournamentPlayers)
    .set({ partnerPlayerId: playerId, updatedAt: now })
    .where(eq(tournamentPlayers.id, partnerRow.id));

  await recordAudit(db, actor, {
    action: 'participant.partner_linked',
    entityType: 'participant',
    entityId: anchor.id,
    tournamentId,
    payload: { playerId, partnerPlayerId },
  });

  return participantDto(db, tournamentId, playerId);
}

export async function unlinkPartner(
  db: Database,
  tournamentId: string,
  playerId: string,
  actor: Viewer,
): Promise<ParticipantDto> {
  const tournament = await getTournamentRow(db, tournamentId);
  if (!isFixedPairsFormat(tournament.format)) {
    throw new ApiError('validation_failed', 'Пары есть только в формате фиксированных пар');
  }
  if (tournament.status !== 'registration' && tournament.status !== 'registration_closed') {
    throw wrongStatus('Отвязать пару можно до старта турнира');
  }

  const [row] = await db
    .select()
    .from(tournamentPlayers)
    .where(
      and(eq(tournamentPlayers.tournamentId, tournamentId), eq(tournamentPlayers.playerId, playerId)),
    )
    .limit(1);
  if (!row) throw notFound('Заявка не найдена');
  if (!row.partnerPlayerId) return participantDto(db, tournamentId, playerId);

  const isOrganizer = canManageTournaments(actor);
  const isSelf = actor.playerId === playerId || actor.playerId === row.partnerPlayerId;
  if (!isOrganizer && !isSelf) throw forbidden();

  const [partner] = await db
    .select()
    .from(tournamentPlayers)
    .where(
      and(
        eq(tournamentPlayers.tournamentId, tournamentId),
        eq(tournamentPlayers.playerId, row.partnerPlayerId),
      ),
    )
    .limit(1);

  if (
    partner &&
    bothPaidLocked(
      row.confirmedAndPaid,
      partner.confirmedAndPaid,
      row.partnerPlayerId,
      partner.partnerPlayerId,
      row.playerId,
      partner.playerId,
    )
  ) {
    throw new ApiError('validation_failed', 'Пара зафиксирована оплатой обеих сторон');
  }

  await db
    .update(tournamentPlayers)
    .set({ partnerPlayerId: null, updatedAt: new Date() })
    .where(eq(tournamentPlayers.id, row.id));
  await clearPartnerLink(db, tournamentId, playerId, row.partnerPlayerId);

  await recordAudit(db, actor, {
    action: 'participant.partner_unlinked',
    entityType: 'participant',
    entityId: row.id,
    tournamentId,
    payload: { playerId, partnerPlayerId: row.partnerPlayerId },
  });

  return participantDto(db, tournamentId, playerId);
}

export async function loadRegisteredPairs(db: Database, tournamentId: string) {
  const joined = await db
    .select({ participant: tournamentPlayers, player: players })
    .from(tournamentPlayers)
    .innerJoin(players, eq(players.id, tournamentPlayers.playerId))
    .where(
      and(
        eq(tournamentPlayers.tournamentId, tournamentId),
        eq(tournamentPlayers.status, 'registered'),
      ),
    );

  const dtos = attachPartners(
    joined.map((row) => ({
      participant: row.participant,
      player: toPlayerDto(row.player),
    })),
  );
  const byId = new Map(dtos.map((item) => [item.player.id, item]));
  const seen = new Set<string>();
  const pairs: { a: ParticipantDto; b: ParticipantDto }[] = [];
  const orphans: ParticipantDto[] = [];

  for (const item of dtos) {
    if (seen.has(item.player.id)) continue;
    const partnerId = item.partnerPlayerId;
    const partner = partnerId ? byId.get(partnerId) : undefined;
    if (!partner || partner.partnerPlayerId !== item.player.id) {
      orphans.push(item);
      seen.add(item.player.id);
      continue;
    }
    seen.add(item.player.id);
    seen.add(partner.player.id);
    pairs.push({ a: item, b: partner });
  }

  return { pairs, orphans, participants: dtos };
}
