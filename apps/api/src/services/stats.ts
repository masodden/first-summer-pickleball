import { and, eq, inArray, isNull } from 'drizzle-orm';
import { isBootstrapAdminDupr, type PlayerProfileDto, type PlayerStatsDto } from '@fsp/shared';
import type { Database } from '../db/index.js';
import { accounts, tournaments } from '../db/schema.js';
import { toPlayerDto } from './mappers.js';
import {
  canEditPlayer,
  getPlayerRow,
  getPlayerStats,
  getRatingHistory,
  restoreContactsFromMergedGuests,
} from './players.js';
import { computeTournamentStandings } from './state.js';
import { canManageTournaments, type Viewer } from '../auth/context.js';

/**
 * Личная статистика игрока по всем турнирам.
 *
 * Медали считаются по итоговым таблицам завершённых турниров, а не хранятся
 * отдельно: так они всегда согласованы с исправлениями счёта.
 */
export async function getPlayerProfile(
  db: Database,
  playerId: string,
  viewer: Viewer | null,
): Promise<PlayerProfileDto> {
  // Лечит старые слияния, где Telegram/фото остались на гостевой карточке.
  const player = await restoreContactsFromMergedGuests(db, playerId);
  const raw = await getPlayerStats(db, playerId);

  const finishedRows =
    raw.tournamentIds.length === 0
      ? []
      : await db
          .select({ id: tournaments.id })
          .from(tournaments)
          .where(
            and(
              inArray(tournaments.id, raw.tournamentIds),
              inArray(tournaments.status, ['finished', 'archived']),
              isNull(tournaments.deletedAt),
            ),
          );

  let gold = 0;
  let silver = 0;
  let bronze = 0;

  for (const row of finishedRows) {
    const [tournament] = await db
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, row.id))
      .limit(1);
    if (!tournament) continue;
    const standings = await computeTournamentStandings(db, tournament);
    const mine = standings.find((entry) => entry.player.id === playerId);
    if (mine?.medal === 'gold') gold += 1;
    else if (mine?.medal === 'silver') silver += 1;
    else if (mine?.medal === 'bronze') bronze += 1;
  }

  const stats: PlayerStatsDto = {
    tournamentsPlayed: raw.tournamentIds.length,
    matchesPlayed: raw.matchesPlayed,
    wins: raw.wins,
    losses: raw.losses,
    draws: raw.draws,
    pointsFor: raw.pointsFor,
    pointsAgainst: raw.pointsAgainst,
    gold,
    silver,
    bronze,
  };

  const isOwner = viewer?.playerId === playerId;
  const bootstrap = isBootstrapAdminDupr(player.duprId);
  const claimed = await isClaimed(db, playerId);

  return {
    player: toPlayerDto(player, { isClaimed: claimed }),
    stats,
    ratingHistory: await getRatingHistory(db, playerId),
    canEdit: canEditPlayer(viewer, playerId),
    // DUPR ID — личные данные: его видит владелец профиля и организаторы.
    canSeeDuprId: isOwner || canManageTournaments(viewer),
    isBootstrapAdmin: bootstrap,
    canManageRole: viewer?.role === 'admin' && !bootstrap,
  };
}

async function isClaimed(db: Database, playerId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.playerId, playerId))
    .limit(1);
  return row !== undefined;
}
