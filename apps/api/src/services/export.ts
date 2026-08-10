import { buildDuprResultsCsv, formatDuprExportFilename } from '@fsp/shared';
import type { Database } from '../db/index.js';
import type { TournamentRow } from '../db/schema.js';
import { loadRounds } from './state.js';

/**
 * CSV для импорта результатов в DUPR (doubles / SIDEOUT).
 * Берёт все матчи с введённым счётом — в том числе из уже завершённых турниров.
 */
export async function buildResultsCsv(db: Database, tournament: TournamentRow): Promise<string> {
  const rounds = await loadRounds(db, tournament);
  const matches = rounds.flatMap((round) => round.matches);
  return buildDuprResultsCsv(
    {
      title: tournament.title,
      category: tournament.category,
      startsAt: tournament.startsAt,
    },
    matches,
  );
}

export function resultsCsvFilename(tournament: TournamentRow): string {
  return formatDuprExportFilename(tournament.startsAt, tournament.title);
}

/** Content-Disposition с ASCII-fallback и UTF-8 именем (кириллица в title). */
export function resultsCsvContentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replaceAll('"', '');
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
