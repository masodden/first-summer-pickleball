import type { MatchDto, ParticipantDto, RoundDto, StandingRowDto, TeamStandingRowDto } from './dto.js';

/**
 * События WebSocket. Комната — конкретный турнир, поэтому у каждого события есть
 * `tournamentId`: два параллельных турнира не мешают друг другу.
 *
 * Живой раунд: `match.updated` — один корт, `round.updated` — раунд целиком
 * (статусы, closed/allScored, таймер). Старт/пауза/финиш/пропуск раунда и
 * пересборка сетки — `schedule.rebuilt`. После `subscribe` сервер сразу шлёт
 * снимок (расписание, состав, таблица), чтобы второй телефон не остался на
 * состоянии до обрыва сети.
 *
 * События с данными приносят готовую полезную нагрузку, одинаковую для всех
 * подписчиков. Всё, что зависит от прав конкретного пользователя (например,
 * можно ли ему управлять турниром), клиент перезапрашивает сам по сигналу
 * `tournament.changed` — иначе наблюдателю можно было бы случайно прислать
 * состояние организатора. Этот сигнал не должен затирать раунды: их уже
 * принесли `round.updated` / `schedule.rebuilt`.
 */
export type ServerEvent =
  | { type: 'hello'; serverTime: string }
  | { type: 'subscribed'; tournamentId: string }
  | { type: 'tournament.changed'; tournamentId: string }
  | { type: 'tournament.deleted'; tournamentId: string }
  | { type: 'participants.updated'; tournamentId: string; participants: ParticipantDto[] }
  | { type: 'round.updated'; tournamentId: string; round: RoundDto }
  | { type: 'match.updated'; tournamentId: string; match: MatchDto }
  | {
      type: 'standings.updated';
      tournamentId: string;
      standings: StandingRowDto[];
      teamStandings?: TeamStandingRowDto[];
    }
  | { type: 'schedule.rebuilt'; tournamentId: string; rounds: RoundDto[] }
  | { type: 'pong'; serverTime: string };

export type ClientEvent =
  | { type: 'subscribe'; tournamentId: string }
  | { type: 'unsubscribe'; tournamentId: string }
  | { type: 'ping' };

export const WS_PATH = '/ws';
/** Клиент считает соединение мёртвым, если тишина дольше этого времени. */
export const WS_HEARTBEAT_MS = 25_000;
