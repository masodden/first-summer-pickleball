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
  games?: MatchDto['games'];
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
    games: partial.games ?? null,
    stage: null,
    groupIndex: null,
    bracketSlot: null,
    winsToTake: 1,
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

/** Официальный пример DUPR (порядок колонок). */
const OFFICIAL_HEADER =
  'matchType,event,date,playerA1,playerA1DuprId,playerA1ExternalId,playerA2,playerA2DuprId,playerA2ExternalId,playerB1,playerB1DuprId,playerB1ExternalId,playerB2,playerB2DuprId,playerB2ExternalId,teamAGame1,teamBGame1,teamAGame2,teamBGame2,teamAGame3,teamBGame3,teamAGame4,teamBGame4,teamAGame5,teamBGame5,location,scoreType';

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
    expect(formatDuprLocation('Центр Пиклбола, Красногорск')).toBe(
      'Центр Пиклбола, Красногорск, Москва, Россия',
    );
  });

  it('без названия площадки оставляет только город', () => {
    expect(formatDuprLocation(null)).toBe('Москва, Россия');
    expect(formatDuprLocation('  ')).toBe('Москва, Россия');
  });
});

describe('formatDuprEventDate', () => {
  it('форматирует YYYY-MM-DD по Москве', () => {
    expect(formatDuprEventDate('2026-01-25T12:00:00.000Z')).toBe('2026-01-25');
  });

  it('не сдвигает вечернее московское время на следующий UTC-день назад', () => {
    expect(formatDuprEventDate('2026-01-25T18:00:00.000Z')).toBe('2026-01-25');
  });
});

describe('formatDuprExportFilename', () => {
  it('следует шаблону DUPR Results', () => {
    expect(formatDuprExportFilename('2026-01-25T12:00:00.000Z', 'Summer Cup')).toBe(
      `2026-01-25 ${DUPR_EVENT_PREFIX} Summer Cup - DUPR Results.csv`,
    );
  });

  it('убирает запрещённые символы из названия', () => {
    expect(formatDuprExportFilename('2026-01-25T12:00:00.000Z', 'Cup: "A"/B')).toBe(
      `2026-01-25 ${DUPR_EVENT_PREFIX} Cup A B - DUPR Results.csv`,
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
    venueName: 'Центр Пиклбола, Красногорск',
  };

  it('совпадает с официальной шапкой DUPR', () => {
    expect(DUPR_CSV_HEADERS.join(',')).toBe(OFFICIAL_HEADER);
  });

  it('пишет строку в порядке шаблона: ExternalId пустые, location и scoreType в конце', () => {
    const csv = buildDuprResultsCsv(tournament, [match({ scoreA: 11, scoreB: 4 })]);
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe(OFFICIAL_HEADER);
    expect(lines).toHaveLength(2);

    const row = parseCsvRow(lines[1]!);
    expect(row).toHaveLength(DUPR_CSV_HEADERS.length);
    expect(row[0]).toBe('D');
    expect(row[1]).toBe(`${DUPR_EVENT_PREFIX} Summer Cup 3.5`);
    expect(row[2]).toBe('2026-01-25');
    expect(row[3]).toBe('Anna One');
    expect(row[4]).toBe('AAAA11');
    expect(row[5]).toBe(''); // ExternalId
    expect(row[6]).toBe('Anna Two');
    expect(row[7]).toBe('AAAA22');
    expect(row[8]).toBe('');
    expect(row[9]).toBe('Boris One');
    expect(row[10]).toBe('BBBB11');
    expect(row[11]).toBe('');
    expect(row[12]).toBe('Boris Two');
    expect(row[13]).toBe('BBBB22');
    expect(row[14]).toBe('');
    expect(row[15]).toBe('11');
    expect(row[16]).toBe('4');
    expect(row.slice(17, 25)).toEqual(['', '', '', '', '', '', '', '']);
    expect(row[25]).toBe('Центр Пиклбола, Красногорск, Москва, Россия');
    expect(row[26]).toBe('SIDEOUT');
  });

  it('для серии Bo3 заполняет game1–3, остальные пустые', () => {
    const csv = buildDuprResultsCsv(tournament, [
      match({
        scoreA: 2,
        scoreB: 1,
        games: [
          { scoreA: 11, scoreB: 8 },
          { scoreA: 9, scoreB: 11 },
          { scoreA: 11, scoreB: 6 },
        ],
      }),
    ]);
    const row = parseCsvRow(csv.trimEnd().split('\n')[1]!);
    expect(row.slice(15, 25)).toEqual(['11', '8', '9', '11', '11', '6', '', '', '', '']);
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
    expect(parseCsvRow(lines[1]!)[15]).toBe('11');
    expect(parseCsvRow(lines[1]!)[16]).toBe('9');
    expect(parseCsvRow(lines[2]!)[15]).toBe('8');
    expect(parseCsvRow(lines[2]!)[16]).toBe('11');
  });

  it('экранирует запятые в location, event и именах', () => {
    const csv = buildDuprResultsCsv(
      {
        title: 'Cup, Open',
        category: null,
        startsAt: '2026-01-25T12:00:00.000Z',
        venueName: 'Центр Пиклбола, Красногорск',
      },
      [
        match({
          scoreA: 11,
          scoreB: 7,
          teamA: [player('E1', 'Eve, A'), player('E2', 'Eve B')],
        }),
      ],
    );
    expect(csv).toContain(`"${DUPR_EVENT_PREFIX} Cup, Open"`);
    expect(csv).toContain('"Центр Пиклбола, Красногорск, Москва, Россия"');
    expect(csv).toContain('"Eve, A"');
    expect(csv.trimEnd().endsWith(',SIDEOUT')).toBe(true);
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
    expect(csv.startsWith(OFFICIAL_HEADER)).toBe(true);
    expect(csv).toContain(`${DUPR_EVENT_PREFIX} Американо вечер`);
    expect(csv).toContain('"Москва, Россия",SIDEOUT');
  });
});
