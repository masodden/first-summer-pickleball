/** Игрок в понимании движка: только идентификатор и рейтинг для балансировки. */
export interface EnginePlayer {
  id: string;
  /** null — рейтинга нет; при балансировке подставляется медиана состава. */
  rating: number | null;
}

export type Team = readonly [string, string];

export interface MatchPlan {
  /** Номер корта, начиная с 1. */
  court: number;
  teamA: Team;
  teamB: Team;
}

export interface RoundPlan {
  /** Индекс раунда, начиная с 0. */
  index: number;
  matches: MatchPlan[];
  /** Кто пропускает раунд, если игроков больше, чем мест на кортах. */
  sittingOut: string[];
}

export type SchedulePlan = RoundPlan[];

export interface MatchResult {
  teamA: readonly string[];
  teamB: readonly string[];
  scoreA: number;
  scoreB: number;
}

export interface StandingRow {
  playerId: string;
  played: number;
  wins: number;
  losses: number;
  draws: number;
  /** Сумма набранных очков — основная метрика классического americano. */
  pointsFor: number;
  pointsAgainst: number;
  diff: number;
}

export type StandingsSortKey = 'points' | 'wins' | 'diff' | 'losses' | 'played' | 'pointsAgainst';

export interface AmericanoScheduleOptions {
  players: readonly EnginePlayer[];
  courts: number;
  rounds: number;
  /** Выравнивать сумму рейтингов в парах внутри каждого матча. */
  ratingBalance?: boolean;
  seed?: number;
}

export interface MexicanoRoundOptions {
  players: readonly EnginePlayer[];
  courts: number;
  roundIndex: number;
  /** Текущая таблица; на первом раунде может быть пустой. */
  standings?: readonly StandingRow[];
  /** Сколько матчей уже сыграл каждый игрок — нужно для честной ротации отдыхающих. */
  gamesPlayed?: Readonly<Record<string, number>>;
  satLastRound?: readonly string[];
  ratingBalance?: boolean;
  seed?: number;
}

export class ScheduleError extends Error {
  constructor(
    public readonly code: 'not_enough_players' | 'schedule_impossible',
    message: string,
  ) {
    super(message);
    this.name = 'ScheduleError';
  }
}
