import { describe, expect, it } from 'vitest';
import type { MatchDto, PlayerDto } from './dto.js';
import {
  buildDuprResultsCsv,
  DUPR_CSV_HEADERS,
  DUPR_EVENT_PREFIX,
  formatDuprEventDate,
  formatDuprEventLabel,
  formatDuprExportFilename,
  formatDuprLocation,
  isDuprExportableMatch,
} from './dupr-export.js';

function player(id: string, fullName: string, duprId: string | null = id): PlayerDto {
  return {
    id,
    duprId,
    firstName: fullName.split(' ')[0] ?? fullName,
    lastName: fullName.split(' ').slice(1).join(' '),
    fullName,
    doublesRating: 3.5,
    singlesRating: null,
    ratingUpdatedAt: null,
    ratingSource: 'import',
    ratingStale: false,
    pendingImportRating: null,
    avatarUrl: null,
    telegramUsername: null,
    clubRole: 'user',
    isGuest: duprId === null,
    isClaimed: duprId !== null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function match(partial: {
  scoreA: number | null;
  scoreB: number | null;
  status?: MatchDto['status'];
  teamA?: PlayerDto[];
  teamB?: PlayerDto[];
}): MatchDto {
  const teamA = partial.teamA ?? [player('AAAA11', 'Anna One'), player('AAAA22', 'Anna Two')];
  const teamB = partial.teamB ?? [player('BBBB11', 'Boris One'), player('BBBB22', 'Boris Two')];
  return {
    id: 'm1',
    roundIndex: 0,
    court: 1,
    courtName: '1',
    status: partial.status ?? 'finished',
    teamA: { players: teamA, score: partial.scoreA },
    teamB: { players: teamB, score: partial.scoreB },
    startedAt: null,
    pausedAt: null,
    pausedTotalMs: 0,
    finishedAt: null,
    durationMs: null,
    version: 1,
  };
}

/** Простой CSV-парсер с учётом кавычек — для проверок колонок с запятыми. */
function parseCsvRow(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells;
}

describe('formatDuprEventLabel', () => {
  it('собирает префикс, title и category', () => {
    expect(formatDuprEventLabel('Summer Cup', '3.0')).toBe(
      `${DUPR_EVENT_PREFIX} Summer Cup 3.0`,
    );
  });

  it('без category не оставляет хвостовой пробел', () => {
    expect(formatDuprEventLabel('Summer Cup', null)).toBe(`${DUPR_EVENT_PREFIX} Summer Cup`);
  });
});

describe('formatDuprLocation', () => {
  it('склеивает название площадки с Москвой', () => {
    expect(formatDuprLocation('First Summer Club, ВДНХ')).toBe(
      'First Summer Club, ВДНХ, Москва, Россия',
    );
  });

  it('без названия площадки оставляет только город', () => {
    expect(formatDuprLocation(null)).toBe('Москва, Россия');
    expect(formatDuprLocation('  ')).toBe('Москва, Россия');
  });
});

describe('formatDuprEventDate', () => {
  it('форматирует YYYY-MM-DD по Москве', () => {
    // 2026-01-25T12:00Z → тот же день в Москве
    expect(formatDuprEventDate('2026-01-25T12:00:00.000Z')).toBe('2026-01-25');
  });

  it('не сдвигает вечернее московское время на следующий UTC-день назад', () => {
    // 21:00 MSK 25 января = 18:00 UTC
    expect(formatDuprEventDate('2026-01-25T18:00:00.000Z')).toBe('2026-01-25');
  });
});

describe('formatDuprExportFilename', () => {
  it('следует шаблону DUPR Results', () => {
    expect(formatDuprExportFilename('2026-01-25T12:00:00.000Z', 'Summer Cup')).toBe(
      '2026-01-25 FIRST SUMMER PICKLEBALL Summer Cup - DUPR Results.csv',
    );
  });

  it('убирает запрещённые символы из названия', () => {
    expect(formatDuprExportFilename('2026-01-25T12:00:00.000Z', 'Cup: "A"/B')).toBe(
      '2026-01-25 FIRST SUMMER PICKLEBALL Cup A B - DUPR Results.csv',
    );
  });
});

describe('isDuprExportableMatch', () => {
  it('принимает сыгранный doubles-матч', () => {
    expect(isDuprExportableMatch(match({ scoreA: 11, scoreB: 8 }))).toBe(true);
  });

  it('отбрасывает матч без счёта и skipped', () => {
    expect(isDuprExportableMatch(match({ scoreA: null, scoreB: null }))).toBe(false);
    expect(isDuprExportableMatch(match({ scoreA: 11, scoreB: 8, status: 'skipped' }))).toBe(
      false,
    );
  });
});

describe('buildDuprResultsCsv', () => {
  const tournament = {
    title: 'Summer Cup',
    category: '3.5',
    startsAt: '2026-01-25T12:00:00.000Z',
    venueName: 'First Summer Club, ВДНХ',
  };

  it('пишет шапку DUPR и одну строку doubles/SIDEOUT с одним геймом', () => {
    const csv = buildDuprResultsCsv(tournament, [match({ scoreA: 11, scoreB: 4 })]);
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe(DUPR_CSV_HEADERS.join(','));
    expect(lines).toHaveLength(2);

    const row = parseCsvRow(lines[1]!);
    expect(row[0]).toBe('D');
    expect(row[1]).toBe('SIDEOUT');
    expect(row[2]).toBe('FIRST SUMMER PICKLEBALL Summer Cup 3.5');
    expect(row[3]).toBe('2026-01-25');
    expect(row[4]).toBe('First Summer Club, ВДНХ, Москва, Россия');
    expect(row[5]).toBe('Anna One');
    expect(row[6]).toBe('AAAA11');
    expect(row[7]).toBe('Anna Two');
    expect(row[8]).toBe('AAAA22');
    expect(row[9]).toBe('Boris One');
    expect(row[10]).toBe('BBBB11');
    expect(row[11]).toBe('Boris Two');
    expect(row[12]).toBe('BBBB22');
    expect(row[13]).toBe('11');
    expect(row[14]).toBe('4');
    // Геймы 2–5 пустые.
    expect(row.slice(15)).toEqual(['', '', '', '', '', '', '', '']);
  });

  it('пропускает незавершённые матчи и экспортирует несколько сыгранных', () => {
    const csv = buildDuprResultsCsv(tournament, [
      match({ scoreA: null, scoreB: null, status: 'scheduled' }),
      match({ scoreA: 11, scoreB: 9 }),
      match({
        scoreA: 8,
        scoreB: 11,
        teamA: [player('C1', 'Cara One'), player('C2', 'Cara Two')],
        teamB: [player('D1', 'Dana One'), player('D2', 'Dana Two')],
      }),
      match({ scoreA: 11, scoreB: 0, status: 'skipped' }),
    ]);
    const lines = csv.trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('11,9');
    expect(lines[2]).toContain('8,11');
  });

  it('экранирует запятые в location, event и именах', () => {
    const csv = buildDuprResultsCsv(
      {
        title: 'Cup, Open',
        category: null,
        startsAt: '2026-01-25T12:00:00.000Z',
        venueName: 'First Summer Club, ВДНХ',
      },
      [
        match({
          scoreA: 11,
          scoreB: 7,
          teamA: [player('E1', 'Eve, A'), player('E2', 'Eve B')],
        }),
      ],
    );
    expect(csv).toContain('"FIRST SUMMER PICKLEBALL Cup, Open"');
    expect(csv).toContain('"First Summer Club, ВДНХ, Москва, Россия"');
    expect(csv).toContain('"Eve, A"');
  });

  it('работает для уже сыгранного турнира без category и venue', () => {
    const csv = buildDuprResultsCsv(
      {
        title: 'Американо вечер',
        category: null,
        startsAt: '2026-08-08T16:00:00.000Z',
        venueName: null,
      },
      [match({ scoreA: 11, scoreB: 8 })],
    );
    expect(csv.startsWith(DUPR_CSV_HEADERS.join(','))).toBe(true);
    expect(csv).toContain('FIRST SUMMER PICKLEBALL Американо вечер');
    expect(csv).toContain('"Москва, Россия"');
    expect(csv).toMatch(/\nD,SIDEOUT,/);
  });
});
