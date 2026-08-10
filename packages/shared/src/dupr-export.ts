import type { MatchDto } from './dto.js';

/** Префикс события в имени файла и в колонке event. */
export const DUPR_EVENT_PREFIX = 'FIRST SUMMER PICKLEBALL';

export const DUPR_CSV_HEADERS = [
  'matchType',
  'scoreType',
  'event',
  'date',
  'location',
  'playerA1',
  'playerA1DuprId',
  'playerA2',
  'playerA2DuprId',
  'playerB1',
  'playerB1DuprId',
  'playerB2',
  'playerB2DuprId',
  'teamAGame1',
  'teamBGame1',
  'teamAGame2',
  'teamBGame2',
  'teamAGame3',
  'teamBGame3',
  'teamAGame4',
  'teamBGame4',
  'teamAGame5',
  'teamBGame5',
] as const;

export interface DuprExportTournament {
  title: string;
  category: string | null;
  startsAt: string | Date;
  /** Название площадки из карточки турнира. */
  venueName: string | null;
}

/** `FIRST SUMMER PICKLEBALL {{ title }} {{ category }}` */
export function formatDuprEventLabel(title: string, category: string | null | undefined): string {
  const parts = [DUPR_EVENT_PREFIX, title.trim()];
  const cat = category?.trim();
  if (cat) parts.push(cat);
  return parts.join(' ');
}

/** `{{ venueName }}, Москва, Россия` — как в шаблоне DUPR. */
export function formatDuprLocation(venueName: string | null | undefined): string {
  const venue = venueName?.trim();
  return venue ? `${venue}, Москва, Россия` : 'Москва, Россия';
}

/**
 * Дата события для DUPR: YYYY-MM-DD по календарю Europe/Moscow
 * (турниры клуба живут в этой зоне).
 */
export function formatDuprEventDate(startsAt: string | Date): string {
  const date = typeof startsAt === 'string' ? new Date(startsAt) : startsAt;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * `yyyy-mm-dd FIRST SUMMER PICKLEBALL {{ title }} - DUPR Results.csv`
 * Недопустимые для файловой системы символы в названии заменяем на пробел.
 */
export function formatDuprExportFilename(startsAt: string | Date, title: string): string {
  const day = formatDuprEventDate(startsAt);
  const safeTitle = title
    .trim()
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${day} ${DUPR_EVENT_PREFIX} ${safeTitle} - DUPR Results.csv`;
}

function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsvRow(cells: readonly (string | number | null | undefined)[]): string {
  return cells.map(escapeCsvCell).join(',');
}

function playerName(player: { fullName: string } | undefined): string {
  return player?.fullName ?? '';
}

function playerDuprId(player: { duprId: string | null } | undefined): string {
  return player?.duprId ?? '';
}

/** Матч готов к выгрузке: есть счёт и по два игрока в командах. */
export function isDuprExportableMatch(match: MatchDto): boolean {
  if (match.status === 'skipped') return false;
  if (match.teamA.score === null || match.teamB.score === null) return false;
  return match.teamA.players.length >= 2 && match.teamB.players.length >= 2;
}

/**
 * CSV для импорта в DUPR: только шапка и строки матчей (без Notes).
 * Всегда doubles + SIDEOUT, один гейм на матч.
 */
export function buildDuprResultsCsv(
  tournament: DuprExportTournament,
  matches: readonly MatchDto[],
): string {
  const event = formatDuprEventLabel(tournament.title, tournament.category);
  const date = formatDuprEventDate(tournament.startsAt);
  const location = formatDuprLocation(tournament.venueName);
  const lines = [toCsvRow(DUPR_CSV_HEADERS)];

  for (const match of matches) {
    if (!isDuprExportableMatch(match)) continue;
    const [a1, a2] = match.teamA.players;
    const [b1, b2] = match.teamB.players;
    lines.push(
      toCsvRow([
        'D',
        'SIDEOUT',
        event,
        date,
        location,
        playerName(a1),
        playerDuprId(a1),
        playerName(a2),
        playerDuprId(a2),
        playerName(b1),
        playerDuprId(b1),
        playerName(b2),
        playerDuprId(b2),
        match.teamA.score,
        match.teamB.score,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
      ]),
    );
  }

  return `${lines.join('\n')}\n`;
}
