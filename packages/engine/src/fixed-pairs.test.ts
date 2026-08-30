import { describe, expect, it } from 'vitest';
import {
  buildFixedPairsGroupSchedule,
  combinedPairRating,
  makePair,
  packPairMatches,
  seatPairMatches,
  resolveSourceToken,
  roundRobinPairings,
  snakeSeedGroups,
} from './fixed-pairs.js';
import { computeTeamStandings, type TeamMatchResult } from './team-standings.js';

function pairs(count: number) {
  return Array.from({ length: count }, (_, index) =>
    makePair(`A${index}`, `B${index}`, 6 - index * 0.1),
  );
}

describe('fixed pairs engine', () => {
  it('собирает RR на 6 пар: 15 матчей', () => {
    const six = pairs(6);
    const games = roundRobinPairings(six);
    expect(games).toHaveLength(15);
  });

  it('упаковывает 6 пар на 2 корта без двойной нагрузки в раунде', () => {
    const six = pairs(6);
    const fixtures = roundRobinPairings(six).map(([teamA, teamB]) => ({
      teamA,
      teamB,
      groupIndex: 0,
    }));
    const packed = packPairMatches(fixtures, 2);
    expect(packed.rounds.every((round) => round.length <= 2)).toBe(true);
    for (const round of packed.rounds) {
      const ids = round.flatMap((match) => [match.teamA.id, match.teamB.id]);
      expect(new Set(ids).size).toBe(ids.length);
    }
    const total = packed.rounds.reduce((sum, round) => sum + round.length, 0);
    expect(total).toBe(15);
  });

  it('пресет 6 пар даёт групповой план', () => {
    const plan = buildFixedPairsGroupSchedule({
      pairs: pairs(6),
      groupCount: 1,
      groupMatchesPerPairing: 1,
      courts: 2,
    });
    expect(plan.length).toBeGreaterThan(0);
    expect(plan[0]!.matches[0]!.stage).toBe('group');
  });

  it('змейка раскладывает по двум группам', () => {
    const groups = snakeSeedGroups(pairs(8), 2);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.length + groups[1]!.length).toBe(8);
  });

  it('суммарный DUPR: 4.2 + 3.8, без рейтинга — null', () => {
    expect(combinedPairRating(4.2, 3.8)).toBeCloseTo(8);
    expect(combinedPairRating(5, null)).toBe(5);
    expect(combinedPairRating(null, null)).toBeNull();
  });

  it('змейка по суммарному DUPR: сильнейший в A, второй в B, обратно', () => {
    const ranked = Array.from({ length: 12 }, (_, index) =>
      makePair(`P${index}a`, `P${index}b`, 12 - index),
    );
    const [groupA, groupB] = snakeSeedGroups(ranked, 2);
    expect(groupA!.map((pair) => pair.rating)).toEqual([12, 9, 8, 5, 4, 1]);
    expect(groupB!.map((pair) => pair.rating)).toEqual([11, 10, 7, 6, 3, 2]);
  });

  it('12 пар, 2 группы, 6 кортов: 5 кругов по 6 матчей', () => {
    const plan = buildFixedPairsGroupSchedule({
      pairs: pairs(12),
      groupCount: 2,
      groupMatchesPerPairing: 1,
      courts: 6,
    });
    expect(plan).toHaveLength(5);
    expect(plan.every((round) => round.matches.length === 6)).toBe(true);
    expect(plan.flatMap((round) => round.matches)).toHaveLength(30);
  });

  it('добивает раунд с четырьмя матчами до шести кортов', () => {
    const twelve = pairs(12);
    const open = {
      index: 5,
      usedCourts: [1, 2, 3, 4],
      pairIds: twelve.slice(0, 8).map((pair) => pair.id),
    };
    const extra = [
      { teamA: twelve[8]!, teamB: twelve[9]!, groupIndex: 0 },
      { teamA: twelve[10]!, teamB: twelve[11]!, groupIndex: 0 },
    ];
    const placed = seatPairMatches(extra, [open], 6);
    expect(placed.seated.map((item) => item.court)).toEqual([5, 6]);
    expect(placed.seated.every((item) => item.roundIndex === 5)).toBe(true);
    expect(placed.packed.rounds).toHaveLength(0);
  });

  it('12 пар: три волны плей-офф добивают корты, а не плодят круги', () => {
    const twelve = pairs(12);
    const qf = [
      { teamA: twelve[0]!, teamB: twelve[6]!, groupIndex: 0 },
      { teamA: twelve[1]!, teamB: twelve[7]!, groupIndex: 0 },
      { teamA: twelve[2]!, teamB: twelve[8]!, groupIndex: 0 },
      { teamA: twelve[3]!, teamB: twelve[9]!, groupIndex: 0 },
    ];
    const p912 = [
      { teamA: twelve[4]!, teamB: twelve[10]!, groupIndex: 0 },
      { teamA: twelve[5]!, teamB: twelve[11]!, groupIndex: 0 },
    ];
    const wave1 = packPairMatches([...qf, ...p912], 6);
    expect(wave1.rounds).toHaveLength(1);
    expect(wave1.rounds[0]).toHaveLength(6);

    const openQf = {
      index: 5,
      usedCourts: wave1.rounds[0]!.map((match) => match.court),
      pairIds: twelve.map((pair) => pair.id),
    };
    const sf = [
      { teamA: twelve[0]!, teamB: twelve[1]!, groupIndex: 0 },
      { teamA: twelve[2]!, teamB: twelve[3]!, groupIndex: 0 },
    ];
    const p58 = [
      { teamA: twelve[6]!, teamB: twelve[7]!, groupIndex: 0 },
      { teamA: twelve[8]!, teamB: twelve[9]!, groupIndex: 0 },
    ];
    const afterQf = seatPairMatches([...sf, ...p58], [openQf], 6);
    expect(afterQf.seated).toHaveLength(0);
    expect(afterQf.packed.rounds).toHaveLength(1);
    expect(afterQf.packed.rounds[0]).toHaveLength(4);

    const openSf = {
      index: 6,
      usedCourts: afterQf.packed.rounds[0]!.map((match) => match.court),
      pairIds: [...twelve.slice(0, 4), ...twelve.slice(6, 10)].map((pair) => pair.id),
    };
    const p9p11 = [
      { teamA: twelve[4]!, teamB: twelve[5]!, groupIndex: 0 },
      { teamA: twelve[10]!, teamB: twelve[11]!, groupIndex: 0 },
    ];
    const afterP912 = seatPairMatches(p9p11, [openQf, openSf], 6);
    expect(afterP912.seated.map((item) => item.court)).toEqual([5, 6]);
    expect(afterP912.seated.every((item) => item.roundIndex === 6)).toBe(true);
    expect(afterP912.packed.rounds).toHaveLength(0);

    const openFullSf = {
      index: 6,
      usedCourts: [1, 2, 3, 4, 5, 6],
      pairIds: twelve.map((pair) => pair.id),
    };
    const finalBronze = [
      { teamA: twelve[0]!, teamB: twelve[2]!, groupIndex: 0 },
      { teamA: twelve[1]!, teamB: twelve[3]!, groupIndex: 0 },
    ];
    const afterSf = seatPairMatches(finalBronze, [openQf, openFullSf], 6);
    expect(afterSf.seated).toHaveLength(0);
    expect(afterSf.packed.rounds).toHaveLength(1);
    expect(afterSf.packed.rounds[0]).toHaveLength(2);

    const openFinal = {
      index: 7,
      usedCourts: afterSf.packed.rounds[0]!.map((match) => match.court),
      pairIds: twelve.slice(0, 4).map((pair) => pair.id),
    };
    const p5p7 = [
      { teamA: twelve[6]!, teamB: twelve[8]!, groupIndex: 0 },
      { teamA: twelve[7]!, teamB: twelve[9]!, groupIndex: 0 },
    ];
    const last = seatPairMatches(p5p7, [openQf, openFullSf, openFinal], 6);
    expect(last.seated.map((item) => item.court)).toEqual([3, 4]);
    expect(last.seated.every((item) => item.roundIndex === 7)).toBe(true);
    expect(last.packed.rounds).toHaveLength(0);
  });

  it('не сажает пару в раунд, где она уже играет — открывает новый', () => {
    const six = pairs(6);
    const open = {
      index: 5,
      usedCourts: [1, 2, 3, 4],
      pairIds: six.slice(0, 4).map((pair) => pair.id),
    };
    const clash = [{ teamA: six[0]!, teamB: six[4]!, groupIndex: 0 }];
    const placed = seatPairMatches(clash, [open], 6);
    expect(placed.seated).toHaveLength(0);
    expect(placed.packed.rounds).toHaveLength(1);
  });

  it('резолвит G1.1, A1 vs B2 и слот.W', () => {
    const six = pairs(6);
    const ranked = [six];
    expect(resolveSourceToken('G1.1', ranked, {})?.id).toBe(six[0]!.id);
    expect(resolveSourceToken('A1', ranked, {})?.id).toBe(six[0]!.id);
    const twoGroups = [six.slice(0, 3), six.slice(3)];
    expect(resolveSourceToken('A1', twoGroups, {})?.id).toBe(six[0]!.id);
    expect(resolveSourceToken('B2', twoGroups, {})?.id).toBe(six[4]!.id);
    expect(
      resolveSourceToken('sf1.W', ranked, { sf1: { winner: six[1]!, loser: six[2]! } })?.id,
    ).toBe(six[1]!.id);
  });

  it('при равенстве побед двух пар смотрит личную встречу', () => {
    const [p1, p2] = pairs(2);
    const results: TeamMatchResult[] = [
      { teamA: p1!, teamB: p2!, scoreA: 1, scoreB: 0, pointsA: 11, pointsB: 9, groupIndex: 0 },
    ];
    const table = computeTeamStandings([p1!, p2!], results, 0);
    expect(table[0]!.pair.id).toBe(p1!.id);
  });

  it('при равенстве побед трёх пар смотрит разницу очков', () => {
    const [p1, p2, p3] = pairs(3);
    const results: TeamMatchResult[] = [
      { teamA: p1!, teamB: p2!, scoreA: 1, scoreB: 0, pointsA: 11, pointsB: 5, groupIndex: 0 },
      { teamA: p1!, teamB: p3!, scoreA: 0, scoreB: 1, pointsA: 8, pointsB: 11, groupIndex: 0 },
      { teamA: p2!, teamB: p3!, scoreA: 1, scoreB: 0, pointsA: 11, pointsB: 9, groupIndex: 0 },
    ];
    const table = computeTeamStandings([p1!, p2!, p3!], results, 0);
    expect(table.map((row) => row.pair.id)).toEqual([p1!.id, p3!.id, p2!.id]);
  });
});
