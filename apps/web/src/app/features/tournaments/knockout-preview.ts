import type { MatchDto, PlayerDto, RoundDto, TeamStandingRowDto } from '@fsp/shared';

/** Стороны слота, если источник уже известен. Пустой массив — ещё прочерк. */
export function previewSlotTeams(
  sourceA: string,
  sourceB: string,
  standings: readonly TeamStandingRowDto[],
  rounds: readonly RoundDto[],
  groupCount: number,
): { teamA: PlayerDto[]; teamB: PlayerDto[] } {
  const matches = rounds.flatMap((round) => round.matches);
  const ranks = completeGroupRanks(standings, matches, groupCount);
  const results = knockoutSlotResults(matches);
  return {
    teamA: resolveSourcePlayers(sourceA, ranks, results),
    teamB: resolveSourcePlayers(sourceB, ranks, results),
  };
}

export function pendingKnockoutMatch(
  slotId: string,
  stage: 'playoff' | 'consolation',
  teamA: readonly PlayerDto[] = [],
  teamB: readonly PlayerDto[] = [],
): MatchDto {
  return {
    id: `pending:${slotId}`,
    roundIndex: -1,
    court: 0,
    courtName: '',
    status: 'scheduled',
    teamA: { players: [...teamA], score: null },
    teamB: { players: [...teamB], score: null },
    startedAt: null,
    pausedAt: null,
    pausedTotalMs: 0,
    finishedAt: null,
    durationMs: null,
    version: 0,
    games: null,
    stage,
    groupIndex: null,
    bracketSlot: slotId,
    winsToTake: 1,
  };
}

function completeGroupRanks(
  standings: readonly TeamStandingRowDto[],
  matches: readonly MatchDto[],
  groupCount: number,
): PlayerDto[][][] {
  const tables: PlayerDto[][][] = Array.from({ length: Math.max(0, groupCount) }, () => []);
  for (const row of standings) {
    const table = tables[row.groupIndex];
    if (!table || row.rank < 1) continue;
    table[row.rank - 1] = [...row.players];
  }
  return tables.map((table, groupIndex) => {
    const groupMatches = matches.filter(
      (match) => match.stage === 'group' && match.groupIndex === groupIndex,
    );
    const complete =
      groupMatches.length > 0 &&
      groupMatches.every(
        (match) =>
          match.status === 'skipped' ||
          (match.teamA.score !== null && match.teamB.score !== null),
      );
    return complete ? table : [];
  });
}

function knockoutSlotResults(
  matches: readonly MatchDto[],
): Record<string, { winner: PlayerDto[]; loser: PlayerDto[] }> {
  const results: Record<string, { winner: PlayerDto[]; loser: PlayerDto[] }> = {};
  for (const match of matches) {
    if (!match.bracketSlot || match.stage === 'group') continue;
    if (match.teamA.score === null || match.teamB.score === null) continue;
    if (match.teamA.players.length < 2 || match.teamB.players.length < 2) continue;
    if (match.teamA.score === match.teamB.score) continue;
    const aWon = match.teamA.score > match.teamB.score;
    results[match.bracketSlot] = {
      winner: aWon ? match.teamA.players : match.teamB.players,
      loser: aWon ? match.teamB.players : match.teamA.players,
    };
  }
  return results;
}

function resolveSourcePlayers(
  token: string,
  ranks: readonly (readonly (readonly PlayerDto[])[])[],
  results: Readonly<Record<string, { winner: PlayerDto[]; loser: PlayerDto[] }>>,
): PlayerDto[] {
  const trimmed = token.trim();
  const groupMatch = /^G(\d+)\.(\d+)$/.exec(trimmed);
  if (groupMatch) {
    return [...(ranks[Number(groupMatch[1]) - 1]?.[Number(groupMatch[2]) - 1] ?? [])];
  }
  const letterMatch = /^([A-Z])(\d+)$/.exec(trimmed);
  if (letterMatch) {
    const group = letterMatch[1]!.charCodeAt(0) - 65;
    return [...(ranks[group]?.[Number(letterMatch[2]) - 1] ?? [])];
  }
  const slotMatch = /^([A-Za-z0-9_-]+)\.(W|L)$/.exec(trimmed);
  if (slotMatch) {
    const result = results[slotMatch[1]!];
    if (!result) return [];
    return [...(slotMatch[2] === 'W' ? result.winner : result.loser)];
  }
  return [];
}
