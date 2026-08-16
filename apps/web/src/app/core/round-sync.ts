import type { MatchDto, RoundDto } from '@fsp/shared';

/** Более новый `version` на клиенте не откатывается запоздавшим пакетом. */
export function patchMatchInRounds(rounds: RoundDto[], match: MatchDto): RoundDto[] {
  const prev = findMatch(rounds, match.id);
  if (prev && prev.version > match.version) return rounds;
  return rounds.map((round) => {
    if (round.index !== match.roundIndex) return round;
    const matches = round.matches.map((item) => (item.id === match.id ? match : item));
    return roundWithMatches(round, matches);
  });
}

export function upsertRound(rounds: RoundDto[], incoming: RoundDto): RoundDto[] {
  const existing = rounds.find((round) => round.index === incoming.index);
  const merged = mergeIncomingRound(incoming, existing);
  return existing
    ? rounds.map((round) => (round.index === merged.index ? merged : round))
    : [...rounds, merged].sort((a, b) => a.index - b.index);
}

export function findMatch(rounds: RoundDto[], id: string): MatchDto | undefined {
  for (const round of rounds) {
    const match = round.matches.find((item) => item.id === id);
    if (match) return match;
  }
  return undefined;
}

function mergeIncomingRound(incoming: RoundDto, existing: RoundDto | undefined): RoundDto {
  if (!existing) return incoming;
  const matches = incoming.matches.map((next) => {
    const prev = existing.matches.find((item) => item.id === next.id);
    return prev && prev.version > next.version ? prev : next;
  });
  return roundWithMatches(incoming, matches);
}

function roundWithMatches(round: RoundDto, matches: MatchDto[]): RoundDto {
  const skipped = matches.length > 0 && matches.every((item) => item.status === 'skipped');
  const closed =
    matches.length > 0 &&
    matches.every((item) => item.status === 'finished' || item.status === 'skipped');
  return {
    ...round,
    matches,
    allFinished: matches.length > 0 && matches.every((item) => item.status === 'finished'),
    allScored:
      matches.length > 0 &&
      matches.every(
        (item) =>
          item.status === 'skipped' || (item.teamA.score !== null && item.teamB.score !== null),
      ),
    skipped,
    closed,
  };
}
