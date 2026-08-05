import type { MatchDto, ParticipantDto, RoundDto, StandingRowDto } from './dto.js';

/**
 * События WebSocket. Комната — конкретный турнир, поэтому у каждого события есть
 * `tournamentId`: два параллельных турнира не мешают друг другу.
 *
 * События с данными приносят готовую полезную нагрузку, одинаковую для всех
 * подписчиков. Всё, что зависит от прав конкретного пользователя (например,
 * можно ли ему управлять турниром), клиент перезапрашивает сам по сигналу
 * `tournament.changed` — иначе наблюдателю можно было бы случайно прислать
 * состояние организатора.
 */
export type ServerEvent =
  | { type: 'hello'; serverTime: string }
  | { type: 'subscribed'; tournamentId: string }
  | { type: 'tournament.changed'; tournamentId: string }
  | { type: 'tournament.deleted'; tournamentId: string }
  | { type: 'participants.updated'; tournamentId: string; participants: ParticipantDto[] }
  | { type: 'round.updated'; tournamentId: string; round: RoundDto }
  | { type: 'match.updated'; tournamentId: string; match: MatchDto }
  | { type: 'standings.updated'; tournamentId: string; standings: StandingRowDto[] }
  | { type: 'schedule.rebuilt'; tournamentId: string; rounds: RoundDto[] }
  | { type: 'pong'; serverTime: string };

export type ClientEvent =
  | { type: 'subscribe'; tournamentId: string }
  | { type: 'unsubscribe'; tournamentId: string }
  | { type: 'ping' };

export const WS_PATH = '/ws';
/** Клиент считает соединение мёртвым, если тишина дольше этого времени. */
export const WS_HEARTBEAT_MS = 25_000;
