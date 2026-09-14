import type { PlayerDto, TeamStandingRowDto } from '@fsp/shared';

/** Посев пары по составу: тот же номер, что в сетке плей-офф. */
export function pairSeed(
  standings: readonly TeamStandingRowDto[],
  players: readonly PlayerDto[],
): number | null {
  if (players.length < 2) return null;
  const ids = new Set(players.map((player) => player.id));
  const row = standings.find(
    (item) => ids.has(item.players[0].id) && ids.has(item.players[1].id),
  );
  return row?.seed ?? null;
}

/** В группе номер не ставим — только плей-офф и матчи за места, как на PPA. */
export function knockoutPairSeed(
  stage: string | null | undefined,
  standings: readonly TeamStandingRowDto[],
  players: readonly PlayerDto[],
): number | null {
  if (stage !== 'playoff' && stage !== 'consolation') return null;
  return pairSeed(standings, players);
}
