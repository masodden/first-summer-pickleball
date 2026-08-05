import type { MatchDto } from '@fsp/shared';
import type { Database } from '../db/index.js';
import { getTournamentRow, listParticipants } from '../services/tournaments.js';
import { computeTournamentStandings, loadRounds } from '../services/state.js';
import type { RealtimeHub } from './hub.js';

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

export function broadcastTournamentChanged(hub: RealtimeHub, tournamentId: string): void {
  hub.broadcast(tournamentId, { type: 'tournament.changed', tournamentId });
}

export function broadcastTournamentDeleted(hub: RealtimeHub, tournamentId: string): void {
  hub.broadcast(tournamentId, { type: 'tournament.deleted', tournamentId });
}
