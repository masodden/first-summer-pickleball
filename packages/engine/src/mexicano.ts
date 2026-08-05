import { createRng } from './rng.js';
import {
  ScheduleError,
  type MatchPlan,
  type MexicanoRoundOptions,
  type RoundPlan,
  type Team,
} from './types.js';
import { matchesPerRound } from './americano.js';

/**
 * Раунд формата mexicano.
 *
 * Первый раунд собирается по рейтингу, каждый следующий — по текущей таблице:
 * лидеры попадают на верхний корт, остальные опускаются. Внутри четвёрки
 * играют первый с четвёртым против второго с третьим, чтобы матч был ровным.
 */
export function generateMexicanoRound(options: MexicanoRoundOptions): RoundPlan {
  const { players, courts, roundIndex } = options;
  const rng = createRng((options.seed ?? 1) + roundIndex * 7919);

  if (players.length < 4) {
    throw new ScheduleError('not_enough_players', 'Для парной игры нужно минимум четыре игрока');
  }
  const perRound = matchesPerRound(players.length, courts);
  if (perRound < 1) {
    throw new ScheduleError('not_enough_players', 'Игроков не хватает даже на один корт');
  }

  const gamesPlayed = options.gamesPlayed ?? {};
  const satLastRound = new Set(options.satLastRound ?? []);
  const standingsOrder = new Map<string, number>();
  (options.standings ?? []).forEach((row, index) => standingsOrder.set(row.playerId, index));

  const shuffled = rng.shuffle(players);
  const ranked = [...shuffled].sort((a, b) => {
    const rankA = standingsOrder.get(a.id);
    const rankB = standingsOrder.get(b.id);
    if (rankA !== undefined && rankB !== undefined && rankA !== rankB) return rankA - rankB;
    if (rankA !== undefined && rankB === undefined) return -1;
    if (rankA === undefined && rankB !== undefined) return 1;
    return (b.rating ?? 0) - (a.rating ?? 0);
  });

  const playingCount = perRound * 4;
  const sittingCount = ranked.length - playingCount;

  let sittingOut: string[] = [];
  if (sittingCount > 0) {
    const byFairness = [...ranked].sort((a, b) => {
      const gamesDiff = (gamesPlayed[b.id] ?? 0) - (gamesPlayed[a.id] ?? 0);
      if (gamesDiff !== 0) return gamesDiff;
      const satA = satLastRound.has(a.id) ? 1 : 0;
      const satB = satLastRound.has(b.id) ? 1 : 0;
      return satA - satB;
    });
    sittingOut = byFairness.slice(0, sittingCount).map((player) => player.id);
  }

  const sitting = new Set(sittingOut);
  const playing = ranked.filter((player) => !sitting.has(player.id));
  const matches: MatchPlan[] = [];

  for (let court = 0; court < perRound; court += 1) {
    const group = playing.slice(court * 4, court * 4 + 4);
    if (group.length < 4) break;
    const [first, second, third, fourth] = group as [
      (typeof group)[number],
      (typeof group)[number],
      (typeof group)[number],
      (typeof group)[number],
    ];
    matches.push({
      court: court + 1,
      teamA: [first.id, fourth.id] as Team,
      teamB: [second.id, third.id] as Team,
    });
  }

  return { index: roundIndex, matches, sittingOut };
}
