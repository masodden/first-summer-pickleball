import {
  RATING_STALE_AFTER_DAYS,
  type ParticipantDto,
  type PlayerDto,
  type PlayerRatingHistoryEntryDto,
} from '@fsp/shared';
import type { PlayerRow, RatingHistoryRow, TournamentPlayerRow } from '../db/schema.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Рейтинг, который давно не обновляли, показывается приглушённым. */
export function isRatingStale(updatedAt: Date | null): boolean {
  if (!updatedAt) return false;
  return Date.now() - updatedAt.getTime() > RATING_STALE_AFTER_DAYS * DAY_MS;
}

export function toPlayerDto(row: PlayerRow, options: { isClaimed?: boolean } = {}): PlayerDto {
  const fullName = [row.firstName, row.lastName].filter(Boolean).join(' ');
  return {
    id: row.id,
    duprId: row.duprId,
    firstName: row.firstName,
    lastName: row.lastName,
    fullName,
    doublesRating: row.doublesRating,
    singlesRating: row.singlesRating,
    ratingUpdatedAt: row.ratingUpdatedAt?.toISOString() ?? null,
    ratingSource: row.ratingSource,
    ratingStale: isRatingStale(row.ratingUpdatedAt),
    avatarUrl: row.avatarUrl,
    telegramUsername: row.telegramUsername,
    clubRole: row.clubRole,
    isGuest: row.isGuest,
    isClaimed: options.isClaimed ?? false,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toParticipantDto(
  row: TournamentPlayerRow,
  player: PlayerDto,
  extras: { partner?: PlayerDto | null; partnerLocked?: boolean } = {},
): ParticipantDto {
  return {
    id: row.id,
    player,
    status: row.status,
    confirmedAndPaid: row.confirmedAndPaid,
    waitlistPosition: row.waitlistPosition,
    addedBySelf: row.addedBySelf,
    partnerPlayerId: row.partnerPlayerId ?? null,
    partner: extras.partner ?? null,
    partnerLocked: extras.partnerLocked ?? false,
    createdAt: row.createdAt.toISOString(),
  };
}

export function attachPartners(
  items: readonly { participant: TournamentPlayerRow; player: PlayerDto }[],
): ParticipantDto[] {
  const byId = new Map(items.map((item) => [item.participant.playerId, item]));
  return items.map((item) => {
    const partnerId = item.participant.partnerPlayerId;
    const partnerItem = partnerId ? byId.get(partnerId) : undefined;
    const partnerLocked = Boolean(
      partnerId &&
        partnerItem &&
        partnerItem.participant.partnerPlayerId === item.participant.playerId &&
        item.participant.confirmedAndPaid &&
        partnerItem.participant.confirmedAndPaid,
    );
    return toParticipantDto(item.participant, item.player, {
      partner: partnerItem ? partnerItem.player : null,
      partnerLocked,
    });
  });
}

export function toRatingHistoryDto(row: RatingHistoryRow): PlayerRatingHistoryEntryDto {
  return {
    id: row.id,
    previousRating: row.previousRating,
    rating: row.rating,
    source: row.source,
    changedByName: row.changedByName,
    createdAt: row.createdAt.toISOString(),
  };
}
