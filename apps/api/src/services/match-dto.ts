import {
  gameSettingsForMatch,
  parseBracketConfig,
  type MatchDto,
} from '@fsp/shared';
import type { MatchRow, TournamentRow } from '../db/schema.js';

export function matchDtoExtras(
  row: MatchRow,
  tournament: TournamentRow,
): Pick<MatchDto, 'games' | 'stage' | 'groupIndex' | 'bracketSlot' | 'winsToTake'> {
  const config = parseBracketConfig(tournament.format, tournament.bracketConfig, tournament.pointsToWin);
  const settings = gameSettingsForMatch(config, {
    stage: row.stage,
    bracketSlot: row.bracketSlot,
  });
  const stage =
    row.stage === 'group' || row.stage === 'playoff' || row.stage === 'consolation'
      ? row.stage
      : null;
  return {
    games: row.games ?? null,
    stage,
    groupIndex: row.groupIndex ?? null,
    bracketSlot: row.bracketSlot ?? null,
    winsToTake: settings.winsToTake,
  };
}
