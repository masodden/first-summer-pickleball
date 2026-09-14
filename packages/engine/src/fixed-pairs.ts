import { ScheduleError, type MatchPlan, type RoundPlan, type SchedulePlan, type Team } from './types.js';

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export interface EnginePair {
  id: string;
  players: Team;
  rating: number | null;
}

export function makePair(a: string, b: string, rating: number | null = null): EnginePair {
  const id = pairKey(a, b);
  const players: Team = a < b ? [a, b] : [b, a];
  return { id, players, rating };
}

/** Суммарный DUPR пары для змейки: оба рейтинга складываются, пропуски игнорируются. */
export function combinedPairRating(...ratings: Array<number | null | undefined>): number | null {
  const values = ratings.filter((value): value is number => typeof value === 'number');
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

export interface PairMatch {
  teamA: EnginePair;
  teamB: EnginePair;
  groupIndex: number;
  stage?: 'group' | 'playoff' | 'consolation';
  bracketSlot?: string;
}

/** Посев: выше суммарный DUPR, при равенстве — стабильный id. */
export function rankPairsBySeed(pairs: readonly EnginePair[]): EnginePair[] {
  return [...pairs].sort(
    (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || a.id.localeCompare(b.id),
  );
}

/** Номер посева 1…n по всему составу, как на сетке ATP / PPA. */
export function pairSeedNumbers(pairs: readonly EnginePair[]): Map<string, number> {
  return new Map(rankPairsBySeed(pairs).map((pair, index) => [pair.id, index + 1]));
}

/** Змейка по рейтингу: 1-я пара → группа 0, 2-я → 1, … затем обратно. */
export function snakeSeedGroups(pairs: readonly EnginePair[], groupCount: number): EnginePair[][] {
  const groups: EnginePair[][] = Array.from({ length: Math.max(1, groupCount) }, () => []);
  const ranked = rankPairsBySeed(pairs);
  const count = groups.length;
  ranked.forEach((pair, index) => {
    const block = Math.floor(index / count);
    const pos = index % count;
    const group = block % 2 === 0 ? pos : count - 1 - pos;
    groups[group]!.push(pair);
  });
  return groups;
}

/** Круговой турнир внутри группы: каждый с каждым. */
export function roundRobinPairings(pairs: readonly EnginePair[]): [EnginePair, EnginePair][] {
  if (pairs.length < 2) return [];
  const list = [...pairs];
  if (list.length % 2 === 1) list.push(makePair('__bye__', '__bye__'));
  const n = list.length;
  const rounds = n - 1;
  const half = n / 2;
  const result: [EnginePair, EnginePair][] = [];
  const circle = list.slice(1);
  for (let round = 0; round < rounds; round += 1) {
    const ordered = [list[0]!, ...circle];
    for (let i = 0; i < half; i += 1) {
      const home = ordered[i]!;
      const away = ordered[n - 1 - i]!;
      if (home.id.includes('__bye__') || away.id.includes('__bye__')) continue;
      result.push([home, away]);
    }
    circle.unshift(circle.pop()!);
  }
  return result;
}

export interface PackedPairMatch extends PairMatch {
  court: number;
}

/**
 * Чем меньше число — тем важнее матч и тем ближе корт 1.
 * Финал / полуфинал впереди, утешение и дружеские — сзади.
 */
export function pairCourtRank(match: Pick<PairMatch, 'stage' | 'bracketSlot'>): number {
  if (match.stage === 'group' || !match.stage) return 100;
  const slot = match.bracketSlot ?? '';
  if (slot === 'final') return 0;
  if (slot === 'bronze') return 1;
  const semi = /^sf(\d*)$/i.exec(slot);
  if (semi) return 10 + Math.max(0, Number(semi[1] || '1') - 1);
  const quarter = /^qf(\d*)$/i.exec(slot);
  if (quarter) return 20 + Math.max(0, Number(quarter[1] || '1') - 1);
  if (match.stage === 'playoff') return 15;
  if (slot.startsWith('p58')) return 32;
  if (slot === 'p5') return 35;
  if (slot === 'p7') return 37;
  if (slot.startsWith('p912')) return 42;
  if (slot === 'p9') return 43;
  if (slot === 'p11') return 45;
  if (slot === 'friendly' || slot.includes('friendly')) return 80;
  const place = Number((/\d+/.exec(slot) ?? [])[0]);
  return Number.isFinite(place) ? 30 + place : 50;
}

function isConsolationMatch(match: Pick<PairMatch, 'stage'>): boolean {
  return match.stage === 'consolation';
}

function comparePairCourts(left: PairMatch, right: PairMatch): number {
  return (
    pairCourtRank(left) - pairCourtRank(right) ||
    (left.bracketSlot ?? '').localeCompare(right.bracketSlot ?? '')
  );
}

function lastFreeCourt(used: readonly number[], courts: number): number | null {
  for (let court = courts; court >= 1; court -= 1) {
    if (!used.includes(court)) return court;
  }
  return null;
}

function firstFreeCourt(used: readonly number[], courts: number): number | null {
  for (let court = 1; court <= courts; court += 1) {
    if (!used.includes(court)) return court;
  }
  return null;
}

/**
 * Титульные — с корта 1 вверх (четверти 1–4, полуфинал/финал 1–2).
 * Утешение — с последних свободных вниз. Занятые корты (уже идущие игры)
 * не трогаем: новый круг из-за этого не открываем.
 */
export function assignPairCourts(
  matches: readonly PairMatch[],
  courts: number,
  occupiedCourts: readonly number[] = [],
): PackedPairMatch[] {
  const used = occupiedCourts.filter((court) => court >= 1 && court <= courts);
  const title = [...matches].filter((match) => !isConsolationMatch(match)).sort(comparePairCourts);
  const consolation = [...matches].filter(isConsolationMatch).sort(comparePairCourts);
  const assigned: PackedPairMatch[] = [];

  const take = (match: PairMatch, fromBack: boolean): void => {
    const court = fromBack ? lastFreeCourt(used, courts) : firstFreeCourt(used, courts);
    if (court === null) return;
    used.push(court);
    assigned.push({ ...match, court });
  };

  for (const match of title) take(match, false);
  for (const match of consolation) take(match, true);
  return assigned;
}

/**
 * Раскладывает матчи по раундам: в раунде не больше `courts` игр,
 * одна пара не играет дважды за раунд. Корты внутри круга — по важности.
 */
export function packPairMatches(
  fixtures: readonly PairMatch[],
  courts: number,
): { rounds: PackedPairMatch[][]; sittingPairIds: string[][] } {
  if (courts < 1) {
    throw new ScheduleError('schedule_impossible', 'Нужен хотя бы один корт');
  }
  const remaining = [...fixtures];
  const rounds: PackedPairMatch[][] = [];
  const sittingPairIds: string[][] = [];
  const allIds = [...new Set(fixtures.flatMap((item) => [item.teamA.id, item.teamB.id]))];

  while (remaining.length > 0) {
    const used = new Set<string>();
    const round: PackedPairMatch[] = [];
    const lastSat = new Set(sittingPairIds.at(-1) ?? []);
    remaining.sort((a, b) => {
      const rest = (match: PairMatch) =>
        (lastSat.has(match.teamA.id) ? 1 : 0) + (lastSat.has(match.teamB.id) ? 1 : 0);
      return rest(b) - rest(a);
    });
    for (let i = 0; i < remaining.length && round.length < courts; ) {
      const match = remaining[i]!;
      if (used.has(match.teamA.id) || used.has(match.teamB.id)) {
        i += 1;
        continue;
      }
      used.add(match.teamA.id);
      used.add(match.teamB.id);
      round.push({ ...match, court: 0 });
      remaining.splice(i, 1);
    }
    if (round.length === 0) {
      throw new ScheduleError('schedule_impossible', 'Не удалось разложить матчи по кортам');
    }
    rounds.push(assignPairCourts(round, courts));
    sittingPairIds.push(allIds.filter((id) => !used.has(id)));
  }
  return { rounds, sittingPairIds };
}

export interface OpenPairRound {
  index: number;
  usedCourts: number[];
  pairIds: string[];
}

export interface SeatedPairMatch {
  match: PairMatch;
  roundIndex: number;
  court: number;
}

/**
 * Добивает уже открытые раунды плей-офф, пока есть свободный корт
 * и пары в этом круге ещё не играют. Титульные сажаем с корта 1,
 * утешение — с последних. Остаток — новый packPairMatches.
 */
export function seatPairMatches(
  fixtures: readonly PairMatch[],
  openRounds: readonly OpenPairRound[],
  courts: number,
): { seated: SeatedPairMatch[]; packed: ReturnType<typeof packPairMatches> } {
  const mutable = openRounds.map((round) => ({
    index: round.index,
    usedCourts: [...round.usedCourts],
    pairIds: new Set(round.pairIds),
  }));
  const seated: SeatedPairMatch[] = [];
  const leftover: PairMatch[] = [];

  for (const match of [...fixtures].sort(comparePairCourts)) {
    const ids = [match.teamA.id, match.teamB.id];
    let placed = false;
    for (let i = mutable.length - 1; i >= 0; i -= 1) {
      const round = mutable[i]!;
      if (round.usedCourts.length >= courts) continue;
      if (ids.some((id) => round.pairIds.has(id))) continue;
      const court = isConsolationMatch(match)
        ? lastFreeCourt(round.usedCourts, courts)
        : firstFreeCourt(round.usedCourts, courts);
      if (court === null) continue;
      round.usedCourts.push(court);
      for (const id of ids) round.pairIds.add(id);
      seated.push({ match, roundIndex: round.index, court });
      placed = true;
      break;
    }
    if (!placed) leftover.push(match);
  }

  return {
    seated,
    packed: leftover.length > 0 ? packPairMatches(leftover, courts) : { rounds: [], sittingPairIds: [] },
  };
}

export function groupScheduleToPlan(
  groups: readonly EnginePair[][],
  courts: number,
  matchesPerPairing = 1,
): SchedulePlan {
  const fixtures: PairMatch[] = [];
  groups.forEach((group, groupIndex) => {
    const pairings = roundRobinPairings(group);
    for (let copy = 0; copy < matchesPerPairing; copy += 1) {
      for (const [teamA, teamB] of pairings) {
        fixtures.push({ teamA, teamB, groupIndex });
      }
    }
  });
  const packed = packPairMatches(fixtures, courts);
  return packed.rounds.map((round, index) => {
    const sittingPlayers = packed.sittingPairIds[index]!.flatMap((id) => {
      const pair = groups.flat().find((item) => item.id === id);
      return pair ? [...pair.players] : [];
    });
    return {
      index,
      sittingOut: sittingPlayers,
      matches: round.map(
        (match): MatchPlan => ({
          court: match.court,
          teamA: match.teamA.players,
          teamB: match.teamB.players,
          stage: 'group',
          groupIndex: match.groupIndex,
          bracketSlot: `G${match.groupIndex + 1}:${match.teamA.id}:${match.teamB.id}`,
        }),
      ),
    } satisfies RoundPlan;
  });
}

export function buildFixedPairsGroupSchedule(options: {
  pairs: readonly EnginePair[];
  courts: number;
  groupCount: number;
  groupMatchesPerPairing: number;
  pairGroups?: Record<string, number>;
}): SchedulePlan {
  const { pairs, courts, groupCount, groupMatchesPerPairing, pairGroups } = options;
  if (pairs.length < 2) {
    throw new ScheduleError('not_enough_players', 'Нужны минимум две пары');
  }
  let groups: EnginePair[][];
  if (pairGroups && Object.keys(pairGroups).length > 0) {
    groups = Array.from({ length: groupCount }, () => []);
    for (const pair of pairs) {
      const index = pairGroups[pair.id] ?? 0;
      groups[Math.min(index, groupCount - 1)]!.push(pair);
    }
  } else {
    groups = snakeSeedGroups(pairs, groupCount);
  }
  return groupScheduleToPlan(groups, courts, groupMatchesPerPairing);
}

export type SourceResult = { winner: EnginePair; loser: EnginePair };

/** Разбирает токен источника: G1.3, A1 / B2 или sf1.W / sf1.L */
export function resolveSourceToken(
  token: string,
  groupRanks: readonly (readonly EnginePair[])[],
  slotResults: Readonly<Record<string, SourceResult>>,
): EnginePair | null {
  const trimmed = token.trim();
  const groupMatch = /^G(\d+)\.(\d+)$/.exec(trimmed);
  if (groupMatch) {
    const group = Number(groupMatch[1]) - 1;
    const rank = Number(groupMatch[2]) - 1;
    return groupRanks[group]?.[rank] ?? null;
  }
  const letterMatch = /^([A-Z])(\d+)$/.exec(trimmed);
  if (letterMatch) {
    const group = letterMatch[1]!.charCodeAt(0) - 65;
    const rank = Number(letterMatch[2]) - 1;
    return groupRanks[group]?.[rank] ?? null;
  }
  const slotMatch = /^([A-Za-z0-9_-]+)\.(W|L)$/.exec(trimmed);
  if (slotMatch) {
    const result = slotResults[slotMatch[1]!];
    if (!result) return null;
    return slotMatch[2] === 'W' ? result.winner : result.loser;
  }
  return null;
}
