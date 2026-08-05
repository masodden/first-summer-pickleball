import type { Database } from '../db/index.js';
import type { TournamentRow } from '../db/schema.js';
import { computeTournamentStandings, loadRounds } from './state.js';

function escapeCell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  return /[",;\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toRow(cells: readonly (string | number | null)[]): string {
  return cells.map(escapeCell).join(';');
}

/**
 * Итоги турнира одним файлом: сначала таблица, затем все матчи.
 * Разделитель — точка с запятой: так Excel с русской локалью открывает файл сразу.
 */
export async function buildResultsCsv(db: Database, tournament: TournamentRow): Promise<string> {
  const [standings, rounds] = await Promise.all([
    computeTournamentStandings(db, tournament),
    loadRounds(db, tournament),
  ]);

  const lines: string[] = [];
  lines.push(toRow([tournament.title, tournament.category, tournament.format]));
  lines.push(toRow(['Дата', tournament.startsAt.toISOString()]));
  lines.push('');

  lines.push(
    toRow([
      'Место',
      'Игрок',
      'DUPR парный',
      'Игр',
      'Победы',
      'Поражения',
      'Ничьи',
      'Очки',
      'Пропущено',
      'Разница',
      'Медаль',
    ]),
  );
  for (const row of standings) {
    lines.push(
      toRow([
        row.rank,
        row.player.fullName,
        row.player.doublesRating,
        row.played,
        row.wins,
        row.losses,
        row.draws,
        row.pointsFor,
        row.pointsAgainst,
        row.diff,
        row.medal ?? '',
      ]),
    );
  }

  lines.push('');
  lines.push(toRow(['Раунд', 'Корт', 'Команда 1', 'Счёт 1', 'Счёт 2', 'Команда 2', 'Статус']));
  for (const round of rounds) {
    for (const match of round.matches) {
      lines.push(
        toRow([
          round.index + 1,
          match.courtName,
          match.teamA.players.map((player) => player.fullName).join(' / '),
          match.teamA.score,
          match.teamB.score,
          match.teamB.players.map((player) => player.fullName).join(' / '),
          match.status,
        ]),
      );
    }
    if (round.sittingOut.length > 0) {
      lines.push(
        toRow([
          round.index + 1,
          'отдых',
          round.sittingOut.map((player) => player.fullName).join(' / '),
        ]),
      );
    }
  }

  return lines.join('\n');
}
