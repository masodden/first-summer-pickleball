import { inject, Injectable } from '@angular/core';
import type {
  AdminStatsDto,
  ClaimRequestDto,
  CreatePlayerInput,
  CreateTournamentInput,
  ImportReportDto,
  InviteDto,
  MatchDto,
  ParticipantDto,
  PlayerDto,
  PlayerProfileDto,
  Role,
  RoundDto,
  StandingRowDto,
  StandingsSortKey,
  TournamentDto,
  TournamentStateDto,
  TournamentSummaryDto,
  UpdatePlayerInput,
  UpdateTournamentInput,
  VenueDto,
} from '@fsp/shared';
import { ApiClient } from './api';

export interface PublicConfigDto {
  ok: boolean;
  telegram: boolean;
  telegramBotUsername: string | null;
  telegramMiniAppShortName: string | null;
  clubContactTelegram: string | null;
  devLogin: boolean;
}

/** Тонкий слой над HTTP: только адреса и типы, без логики экранов. */
@Injectable({ providedIn: 'root' })
export class TournamentApi {
  private readonly api = inject(ApiClient);

  getHealth(): Promise<PublicConfigDto> {
    return this.api.get('/api/health');
  }

  listTournaments(): Promise<{ items: TournamentSummaryDto[] }> {
    return this.api.get('/api/tournaments');
  }

  getTournament(id: string): Promise<{ tournament: TournamentDto }> {
    return this.api.get(`/api/tournaments/${id}`);
  }

  getState(id: string): Promise<TournamentStateDto> {
    return this.api.get(`/api/tournaments/${id}/state`);
  }

  getStandings(
    id: string,
    sort?: readonly StandingsSortKey[],
  ): Promise<{ standings: StandingRowDto[] }> {
    return this.api.get(`/api/tournaments/${id}/standings`, {
      ...(sort?.length ? { query: { sort: sort.join(',') } } : {}),
    });
  }

  getRounds(id: string): Promise<{ rounds: RoundDto[] }> {
    return this.api.get(`/api/tournaments/${id}/rounds`);
  }

  createTournament(input: CreateTournamentInput): Promise<{ tournament: TournamentDto }> {
    return this.api.post('/api/tournaments', input, { queueLabel: 'Создание турнира' });
  }

  updateTournament(
    id: string,
    input: UpdateTournamentInput,
  ): Promise<{ tournament: TournamentDto }> {
    return this.api.patch(`/api/tournaments/${id}`, input, { queueLabel: 'Изменение турнира' });
  }

  deleteTournament(id: string): Promise<void> {
    return this.api.delete(`/api/tournaments/${id}`);
  }

  addParticipant(id: string, playerId: string): Promise<{ participant: ParticipantDto }> {
    return this.api.post(
      `/api/tournaments/${id}/participants`,
      { playerId },
      { queueLabel: 'Добавление игрока' },
    );
  }

  removeParticipant(id: string, playerId: string): Promise<void> {
    return this.api.delete(`/api/tournaments/${id}/participants/${playerId}`);
  }

  join(id: string): Promise<{ participant: ParticipantDto; waitlisted: boolean }> {
    return this.api.post(`/api/tournaments/${id}/join`, undefined, { queueLabel: 'Заявка' });
  }

  leave(id: string): Promise<void> {
    return this.api.post(`/api/tournaments/${id}/leave`);
  }

  setPaid(
    id: string,
    playerId: string,
    confirmedAndPaid: boolean,
  ): Promise<{ participant: ParticipantDto }> {
    return this.api.put(
      `/api/tournaments/${id}/participants/${playerId}/paid`,
      { confirmedAndPaid },
      { queueLabel: 'Отметка об оплате' },
    );
  }

  promote(
    id: string,
    playerId: string,
    replacePlayerId?: string,
  ): Promise<{ participant: ParticipantDto }> {
    return this.api.post(
      `/api/tournaments/${id}/participants/${playerId}/promote`,
      replacePlayerId ? { replacePlayerId } : {},
    );
  }

  closeRegistration(id: string): Promise<{ tournament: TournamentDto }> {
    return this.api.post(`/api/tournaments/${id}/registration/close`);
  }

  openRegistration(id: string): Promise<{ tournament: TournamentDto }> {
    return this.api.post(`/api/tournaments/${id}/registration/open`);
  }

  start(id: string, seed?: number): Promise<{ tournament: TournamentDto }> {
    return this.api.post(`/api/tournaments/${id}/start`, seed === undefined ? {} : { seed }, {
      queueLabel: 'Создание турнира',
    });
  }

  reshuffle(id: string, seed?: number): Promise<{ rounds: RoundDto[] }> {
    return this.api.post(`/api/tournaments/${id}/reshuffle`, seed === undefined ? {} : { seed });
  }

  createNextRound(id: string): Promise<{ roundIndex: number }> {
    return this.api.post(`/api/tournaments/${id}/rounds`);
  }

  /** Старт, пауза, завершение или пропуск всех кортов раунда одним запросом. */
  roundAction(
    id: string,
    index: number,
    action: 'start' | 'pause' | 'finish' | 'skip' | 'unskip',
  ): Promise<{ rounds: RoundDto[] }> {
    return this.api.post(
      `/api/tournaments/${id}/rounds/${index}/${action}`,
      {},
      { queueLabel: 'Раунд' },
    );
  }

  unstart(id: string): Promise<{ tournament: TournamentDto }> {
    return this.api.post(`/api/tournaments/${id}/unstart`);
  }

  finish(id: string): Promise<{ tournament: TournamentDto }> {
    return this.api.post(`/api/tournaments/${id}/finish`);
  }

  reopen(id: string): Promise<{ tournament: TournamentDto }> {
    return this.api.post(`/api/tournaments/${id}/reopen`);
  }

  archive(id: string): Promise<{ tournament: TournamentDto }> {
    return this.api.post(`/api/tournaments/${id}/archive`);
  }

  unarchive(id: string): Promise<{ tournament: TournamentDto }> {
    return this.api.post(`/api/tournaments/${id}/unarchive`);
  }

  exportCsv(id: string, filename: string): Promise<void> {
    return this.api.download(`/api/tournaments/${id}/export.csv`, filename);
  }

  setScore(
    matchId: string,
    scoreA: number,
    scoreB: number,
    version: number,
  ): Promise<{ match: MatchDto }> {
    return this.api.put(
      `/api/matches/${matchId}/score`,
      { scoreA, scoreB, version },
      { queueLabel: 'Счёт матча' },
    );
  }

  searchPlayers(query: string, includeGuests = true): Promise<{ items: PlayerDto[] }> {
    return this.api.get('/api/players', { query: { query, includeGuests, limit: 40 } });
  }

  getPlayer(id: string): Promise<PlayerProfileDto> {
    return this.api.get(`/api/players/${id}`);
  }

  createPlayer(input: CreatePlayerInput): Promise<{ player: PlayerDto }> {
    return this.api.post('/api/players', input, { queueLabel: 'Новая карточка игрока' });
  }

  updatePlayer(id: string, input: UpdatePlayerInput): Promise<{ player: PlayerDto }> {
    return this.api.patch(`/api/players/${id}`, input, { queueLabel: 'Изменение профиля' });
  }

  deletePlayer(id: string): Promise<{ ok: true }> {
    return this.api.delete(`/api/players/${id}`);
  }

  setRating(id: string, doublesRating: number | null): Promise<{ player: PlayerDto }> {
    return this.api.put(
      `/api/players/${id}/rating`,
      { doublesRating },
      { queueLabel: 'Изменение рейтинга' },
    );
  }

  resolveRatingConflict(id: string, accept: boolean): Promise<{ player: PlayerDto }> {
    return this.api.post(`/api/players/${id}/rating-conflict`, { accept });
  }

  mergeGuest(id: string, duprId: string): Promise<{ player: PlayerDto }> {
    return this.api.post(`/api/players/${id}/merge`, { duprId });
  }

  createInvite(playerId: string): Promise<{ invite: InviteDto }> {
    return this.api.post(`/api/players/${playerId}/invite`);
  }

  nudgeContact(playerId: string): Promise<{ ok: true; contactTelegram: string }> {
    return this.api.post(`/api/players/${playerId}/nudge-contact`);
  }

  importPlayers(content: string): Promise<{ report: ImportReportDto }> {
    return this.api.post('/api/players/import', { content });
  }

  listVenues(): Promise<{ venues: VenueDto[] }> {
    return this.api.get('/api/venues');
  }

  createVenue(input: {
    name: string;
    address?: string | null;
    mapUrl?: string | null;
  }): Promise<{ venue: VenueDto }> {
    return this.api.post('/api/venues', input);
  }

  listClaims(): Promise<{ claims: ClaimRequestDto[] }> {
    return this.api.get('/api/claims');
  }

  decideClaim(id: string, approve: boolean): Promise<void> {
    return this.api.post(`/api/claims/${id}/decision`, { approve });
  }

  listAccounts(): Promise<{ accounts: AccountRowDto[] }> {
    return this.api.get('/api/admin/accounts');
  }

  getAdminStats(): Promise<{ stats: AdminStatsDto }> {
    return this.api.get('/api/admin/stats');
  }

  setAccountRole(id: string, role: Role): Promise<void> {
    return this.api.put(`/api/admin/accounts/${id}/role`, { role });
  }

  setPlayerRole(playerId: string, role: Role): Promise<void> {
    return this.api.put(`/api/players/${playerId}/role`, { role });
  }

  getPublicBoard(slug: string): Promise<PublicBoardDto> {
    return this.api.get(`/api/public/${slug}`);
  }
}

export interface AccountRowDto {
  id: string;
  role: Role;
  displayName: string;
  telegramUsername: string | null;
  playerName: string | null;
  duprId: string | null;
  isBootstrapAdmin: boolean;
  lastSeenAt: string;
}

export interface PublicBoardDto {
  tournament: TournamentSummaryDto;
  venue: { name: string | null; address: string | null; mapUrl: string | null };
  description: string | null;
  rounds: RoundDto[];
  standings: StandingRowDto[];
  participants: ParticipantDto[];
}
