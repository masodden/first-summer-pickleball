import { buildRatingLookup, matchImbalance, optimizeSeating } from './balance.js';
import { assignRoundCourts, balanceScheduleCourts, courtUsageFromMatches } from './courts.js';
import { PairHistory } from './history.js';
import { buildSeatSchedule } from './pairings.js';
import { createRng, type Rng } from './rng.js';
import {
  ScheduleError,
  type AmericanoScheduleOptions,
  type EnginePlayer,
  type MatchPlan,
  type RoundPlan,
  type SchedulePlan,
  type Team,
} from './types.js';

const PARTNER_REPEAT_PENALTY = 1000;
const OPPONENT_REPEAT_PENALTY = 40;
const PAIRING_ATTEMPTS = 120;

/** Сколько матчей реально можно провести за раунд. */
export function matchesPerRound(playerCount: number, courts: number): number {
  return Math.min(courts, Math.floor(playerCount / 4));
}

/**
 * Точное расписание собирается, когда игроков кратно четырём и кортов хватает,
 * чтобы все играли одновременно. Тогда работает 1-факторизование и каждый
 * гарантированно играет в паре с каждым.
 */
export function canUseExactSchedule(playerCount: number, courts: number, rounds: number): boolean {
  return (
    playerCount % 4 === 0 &&
    courts * 4 >= playerCount &&
    rounds <= playerCount - 1 &&
    playerCount >= 4
  );
}

function pairUpGreedily(order: readonly string[], history: PairHistory): Team[] {
  const remaining = [...order];
  const pairs: Team[] = [];

  while (remaining.length >= 2) {
    const anchor = remaining.shift() as string;
    let bestIndex = 0;
    let bestCount = Number.POSITIVE_INFINITY;

    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index] as string;
      const count = history.partnerCount(anchor, candidate);
      if (count < bestCount) {
        bestCount = count;
        bestIndex = index;
        if (count === 0) break;
      }
    }

    const partner = remaining.splice(bestIndex, 1)[0] as string;
    pairs.push([anchor, partner]);
  }

  return pairs;
}

function groupPairs(
  pairs: readonly Team[],
  history: PairHistory,
  rating: (id: string) => number,
  ratingBalance: boolean,
  maxMatches: number,
): MatchPlan[] {
  const remaining = [...pairs];
  const matches: MatchPlan[] = [];

  while (remaining.length >= 2 && matches.length < maxMatches) {
    const teamA = remaining.shift() as Team;
    let bestIndex = 0;
    let bestCost = Number.POSITIVE_INFINITY;

    for (let index = 0; index < remaining.length; index += 1) {
      const teamB = remaining[index] as Team;
      let cost = 0;
      for (const a of teamA) {
        for (const b of teamB) {
          cost += history.opponentCount(a, b) * OPPONENT_REPEAT_PENALTY;
        }
      }
      if (ratingBalance) {
        cost += matchImbalance({ court: 1, teamA, teamB }, rating);
      }
      if (cost < bestCost) {
        bestCost = cost;
        bestIndex = index;
      }
    }

    const teamB = remaining.splice(bestIndex, 1)[0] as Team;
    matches.push({ court: matches.length + 1, teamA, teamB });
  }

  return matches;
}

function scoreRound(
  matches: readonly MatchPlan[],
  history: PairHistory,
  rating: (id: string) => number,
  ratingBalance: boolean,
): number {
  let cost = 0;
  for (const match of matches) {
    cost += history.partnerCount(match.teamA[0], match.teamA[1]) * PARTNER_REPEAT_PENALTY;
    cost += history.partnerCount(match.teamB[0], match.teamB[1]) * PARTNER_REPEAT_PENALTY;
    for (const a of match.teamA) {
      for (const b of match.teamB) {
        cost += history.opponentCount(a, b) * OPPONENT_REPEAT_PENALTY;
      }
    }
    if (ratingBalance) {
      cost += matchImbalance(match, rating);
    }
  }
  return cost;
}

/** Кто отдыхает: сначала те, кто сыграл больше всех, но не сидел в прошлом раунде. */
function chooseSittingOut(
  playerIds: readonly string[],
  count: number,
  history: PairHistory,
  satLastRound: ReadonlySet<string>,
  rng: Rng,
): string[] {
  if (count <= 0) return [];
  const shuffled = rng.shuffle(playerIds);
  const ranked = [...shuffled].sort((a, b) => {
    const gamesDiff = history.gamesPlayed(b) - history.gamesPlayed(a);
    if (gamesDiff !== 0) return gamesDiff;
    const satA = satLastRound.has(a) ? 1 : 0;
    const satB = satLastRound.has(b) ? 1 : 0;
    return satA - satB;
  });
  return ranked.slice(0, count);
}

function buildHeuristicRound(
  playing: readonly string[],
  history: PairHistory,
  rating: (id: string) => number,
  ratingBalance: boolean,
  maxMatches: number,
  rng: Rng,
): MatchPlan[] {
  let best: MatchPlan[] = [];
  let bestCost = Number.POSITIVE_INFINITY;

  for (let attempt = 0; attempt < PAIRING_ATTEMPTS; attempt += 1) {
    const order = rng.shuffle(playing);
    const pairs = pairUpGreedily(order, history);
    const matches = groupPairs(pairs, history, rating, ratingBalance, maxMatches);
    const cost = scoreRound(matches, history, rating, ratingBalance);
    if (cost < bestCost) {
      bestCost = cost;
      best = matches;
      if (cost === 0) break;
    }
  }

  return best;
}

/**
 * Расписание для формата americano.
 *
 * Если состав «ровный» (кратен четырём и кортов хватает на всех), используется
 * точная конструкция: каждый играет в паре с каждым ровно один раз.
 * В остальных случаях работает эвристика, которая минимизирует повторы партнёров
 * и соперников и честно ротирует отдыхающих.
 */
export function generateAmericanoSchedule(options: AmericanoScheduleOptions): SchedulePlan {
  const { players, courts, rounds } = options;
  const ratingBalance = options.ratingBalance ?? true;
  const rng = createRng(options.seed ?? 1);

  if (players.length < 4) {
    throw new ScheduleError('not_enough_players', 'Для парной игры нужно минимум четыре игрока');
  }
  if (courts < 1) {
    throw new ScheduleError('schedule_impossible', 'Нужен хотя бы один корт');
  }
  if (rounds < 1) {
    throw new ScheduleError('schedule_impossible', 'Количество раундов должно быть больше нуля');
  }
  const perRound = matchesPerRound(players.length, courts);
  if (perRound < 1) {
    throw new ScheduleError('not_enough_players', 'Игроков не хватает даже на один корт');
  }

  if (canUseExactSchedule(players.length, courts, rounds)) {
    const seatRounds = buildSeatSchedule(players.length, courts, rounds, rng);
    const seating = optimizeSeating(seatRounds, players, rng, { ratingBalance });
    const named = seatRounds.map((round) => ({
      index: round.index,
      matches: round.matches.map((match) => ({
        court: match.court,
        teamA: [seating[match.teamA[0]] as string, seating[match.teamA[1]] as string] as Team,
        teamB: [seating[match.teamB[0]] as string, seating[match.teamB[1]] as string] as Team,
      })),
      sittingOut: round.sittingOut.map((seat) => seating[seat] as string),
    }));
    return balanceScheduleCourts(named, courts, new Map(), rng);
  }

  const { get: rating } = buildRatingLookup(players);
  const history = new PairHistory();
  const ids = players.map((player) => player.id);
  const schedule: RoundPlan[] = [];
  let satLastRound = new Set<string>();

  for (let index = 0; index < rounds; index += 1) {
    const sittingOut = chooseSittingOut(ids, ids.length - perRound * 4, history, satLastRound, rng);
    const sitting = new Set(sittingOut);
    const playing = ids.filter((id) => !sitting.has(id));
    const matches = buildHeuristicRound(playing, history, rating, ratingBalance, perRound, rng);

    for (const match of matches) {
      history.registerMatch(match);
    }
    schedule.push({ index, matches, sittingOut });
    satLastRound = sitting;
  }

  return balanceScheduleCourts(schedule, courts, new Map(), rng);
}

export interface NextAmericanoRoundOptions {
  players: readonly EnginePlayer[];
  courts: number;
  roundIndex: number;
  /**
   * Уже сыгранные матчи турнира: из них восстанавливается история пар и то,
   * кто на каких кортах уже играл.
   */
  playedMatches: readonly { court?: number; teamA: Team; teamB: Team }[];
  satLastRound?: readonly string[];
  ratingBalance?: boolean;
  seed?: number;
}

/**
 * Достраивает ещё один раунд к уже идущему турниру.
 *
 * Нужен для формата «играем, пока не остановят»: расписание нельзя пересобрать
 * целиком, потому что часть матчей уже сыграна, поэтому новый раунд подбирается
 * по накопленной истории пар и соперников.
 */
export function nextAmericanoRound(options: NextAmericanoRoundOptions): RoundPlan {
  const { players, courts, roundIndex, playedMatches } = options;
  const ratingBalance = options.ratingBalance ?? true;
  const rng = createRng((options.seed ?? 1) + roundIndex * 7919);

  if (players.length < 4) {
    throw new ScheduleError('not_enough_players', 'Для парной игры нужно минимум четыре игрока');
  }
  const perRound = matchesPerRound(players.length, courts);
  if (perRound < 1) {
    throw new ScheduleError('not_enough_players', 'Игроков не хватает даже на один корт');
  }

  const history = new PairHistory();
  for (const match of playedMatches) {
    history.registerMatch({ court: 1, teamA: match.teamA, teamB: match.teamB });
  }

  const ids = players.map((player) => player.id);
  const { get: rating } = buildRatingLookup(players);
  const satLastRound = new Set(options.satLastRound ?? []);
  const sittingOut = chooseSittingOut(ids, ids.length - perRound * 4, history, satLastRound, rng);
  const sitting = new Set(sittingOut);
  const playing = ids.filter((id) => !sitting.has(id));
  const matches = buildHeuristicRound(playing, history, rating, ratingBalance, perRound, rng);

  const courtUsage = courtUsageFromMatches(
    playedMatches.filter(
      (match): match is { court: number; teamA: Team; teamB: Team } => match.court !== undefined,
    ),
    courts,
  );
  return assignRoundCourts({ index: roundIndex, matches, sittingOut }, courts, courtUsage);
}

/**
 * Пересобирает расписание с новым seed: структура формата сохраняется,
 * но конкретные пары на кортах меняются.
 */
export function reshuffleAmericanoSchedule(
  options: AmericanoScheduleOptions & { seed: number },
): SchedulePlan {
  return generateAmericanoSchedule(options);
}

export function collectPlayers(schedule: SchedulePlan): string[] {
  const ids = new Set<string>();
  for (const round of schedule) {
    for (const match of round.matches) {
      for (const id of [...match.teamA, ...match.teamB]) ids.add(id);
    }
    for (const id of round.sittingOut) ids.add(id);
  }
  return [...ids];
}

export function describeSchedule(
  schedule: SchedulePlan,
  players: readonly EnginePlayer[],
): {
  maxPartnerRepeats: number;
  maxOpponentRepeats: number;
  gamesPlayedSpread: number;
  totalImbalance: number;
} {
  const history = new PairHistory();
  const { get: rating } = buildRatingLookup(players);
  let maxPartnerRepeats = 0;
  let maxOpponentRepeats = 0;
  let totalImbalance = 0;

  for (const round of schedule) {
    for (const match of round.matches) {
      maxPartnerRepeats = Math.max(
        maxPartnerRepeats,
        history.partnerCount(match.teamA[0], match.teamA[1]),
        history.partnerCount(match.teamB[0], match.teamB[1]),
      );
      for (const a of match.teamA) {
        for (const b of match.teamB) {
          maxOpponentRepeats = Math.max(maxOpponentRepeats, history.opponentCount(a, b));
        }
      }
      totalImbalance += matchImbalance(match, rating);
      history.registerMatch(match);
    }
  }

  const counts = players.map((player) => history.gamesPlayed(player.id));
  const spread = counts.length === 0 ? 0 : Math.max(...counts) - Math.min(...counts);

  return {
    maxPartnerRepeats,
    maxOpponentRepeats,
    gamesPlayedSpread: spread,
    totalImbalance,
  };
}
