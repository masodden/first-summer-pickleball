import type { MatchDto } from '@fsp/shared';
import type { Database } from '../db/index.js';
import { getTournamentRow, listParticipants } from '../services/tournaments.js';
import { computeTournamentStandings, loadRound, loadRounds } from '../services/state.js';
import type { RealtimeHub, RealtimeSocket } from './hub.js';

/**
 * Рассылка изменений. Таблица пересчитывается почти при любом действии, поэтому
 * она уезжает вместе с большинством событий — зрители видят живой счёт.
 */
export async function broadcastStandings(
  db: Database,
  hub: RealtimeHub,
  tournamentId: string,
): Promise<void> {
  if (hub.roomSize(tournamentId) === 0) return;
  const row = await getTournamentRow(db, tournamentId);
  const standings = await computeTournamentStandings(db, row);
  hub.broadcast(tournamentId, { type: 'standings.updated', tournamentId, standings });
}

export async function broadcastParticipants(
  db: Database,
  hub: RealtimeHub,
  tournamentId: string,
): Promise<void> {
  if (hub.roomSize(tournamentId) === 0) return;
  const { participants } = await listParticipants(db, tournamentId);
  hub.broadcast(tournamentId, { type: 'participants.updated', tournamentId, participants });
  hub.broadcast(tournamentId, { type: 'tournament.changed', tournamentId });
}

export function broadcastMatch(hub: RealtimeHub, tournamentId: string, match: MatchDto): void {
  hub.broadcast(tournamentId, { type: 'match.updated', tournamentId, match });
}

/**
 * Раунд целиком: второй телефон видит те же closed / allScored / статусы кортов,
 * даже если одно из `match.updated` потерялось на слабой сети.
 */
export async function broadcastRound(
  db: Database,
  hub: RealtimeHub,
  tournamentId: string,
  roundIndex: number,
): Promise<void> {
  if (hub.roomSize(tournamentId) === 0) return;
  const row = await getTournamentRow(db, tournamentId);
  const round = await loadRound(db, row, roundIndex);
  if (!round) return;
  hub.broadcast(tournamentId, { type: 'round.updated', tournamentId, round });
}

/**
 * Снимок после `subscribe`: на мобильном WebSocket часто рвётся, и без этого
 * второй телефон остаётся на состоянии до обрыва.
 */
export async function pushTournamentSnapshot(
  db: Database,
  hub: RealtimeHub,
  socket: RealtimeSocket,
  tournamentId: string,
): Promise<void> {
  try {
    const row = await getTournamentRow(db, tournamentId);
    const rounds = await loadRounds(db, row);
    hub.send(socket, { type: 'schedule.rebuilt', tournamentId, rounds });
    const { participants } = await listParticipants(db, tournamentId);
    hub.send(socket, { type: 'participants.updated', tournamentId, participants });
    const standings = await computeTournamentStandings(db, row);
    hub.send(socket, { type: 'standings.updated', tournamentId, standings });
    hub.send(socket, { type: 'tournament.changed', tournamentId });
  } catch {
    // Турнир уже удалили — клиент узнает с HTTP.
  }
}

export async function broadcastSchedule(
  db: Database,
  hub: RealtimeHub,
  tournamentId: string,
): Promise<void> {
  if (hub.roomSize(tournamentId) === 0) return;
  const row = await getTournamentRow(db, tournamentId);
  const rounds = await loadRounds(db, row);
  hub.broadcast(tournamentId, { type: 'schedule.rebuilt', tournamentId, rounds });
  hub.broadcast(tournamentId, { type: 'tournament.changed', tournamentId });
  const standings = await computeTournamentStandings(db, row);
  hub.broadcast(tournamentId, { type: 'standings.updated', tournamentId, standings });
}

/**
 * Смена статуса турнира (финиш, возврат, архив): карточка уезжает сигналом,
 * таблица — с медалями. Без standings второй телефон остаётся без подиума.
 */
export async function broadcastStatusAndStandings(
  db: Database,
  hub: RealtimeHub,
  tournamentId: string,
): Promise<void> {
  await broadcastStandings(db, hub, tournamentId);
  broadcastTournamentChanged(hub, tournamentId);
}

export function broadcastTournamentChanged(hub: RealtimeHub, tournamentId: string): void {
  hub.broadcast(tournamentId, { type: 'tournament.changed', tournamentId });
}

export function broadcastTournamentDeleted(hub: RealtimeHub, tournamentId: string): void {
  hub.broadcast(tournamentId, { type: 'tournament.deleted', tournamentId });
}
