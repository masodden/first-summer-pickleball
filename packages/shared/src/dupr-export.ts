import type { MatchDto } from './dto.js';
import { APP_NAME } from './domain.js';

/** Префикс события в имени файла и в колонке event. */
export const DUPR_EVENT_PREFIX = APP_NAME;

/**
 * Заголовки ровно как в шаблоне DUPR (club CSV import).
 * Порядок и наличие *ExternalId обязательны — иначе импортёр пишет
 * «Missing required columns», даже если данные в файле есть.
 */
export const DUPR_CSV_HEADERS = [
  'matchType',
  'event',
  'date',
  'playerA1',
  'playerA1DuprId',
  'playerA1ExternalId',
  'playerA2',
  'playerA2DuprId',
  'playerA2ExternalId',
  'playerB1',
  'playerB1DuprId',
  'playerB1ExternalId',
  'playerB2',
  'playerB2DuprId',
  'playerB2ExternalId',
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
  'location',
  'scoreType',
] as const;

export interface DuprExportTournament {
  title: string;
  category: string | null;
  startsAt: string | Date;
  /** Название площадки из карточки турнира. */
  venueName: string | null;
}

/** `PICKLEBALL Events {{ title }} {{ category }}` */
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
 * `yyyy-mm-dd PICKLEBALL Events {{ title }} - DUPR Results.csv`
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

/** Геймы серии → game1…game5; одиночный матч — только game1 из счёта. */
function gameScores(match: MatchDto): Array<string | number> {
  const cells: Array<string | number> = [];
  const games = match.games?.length ? match.games : [{ scoreA: match.teamA.score ?? 0, scoreB: match.teamB.score ?? 0 }];
  for (let index = 0; index < 5; index += 1) {
    const game = games[index];
    if (game) {
      cells.push(game.scoreA, game.scoreB);
    } else {
      cells.push('', '');
    }
  }
  return cells;
}

/** Матч готов к выгрузке: есть счёт и по два игрока в командах. */
export function isDuprExportableMatch(match: MatchDto): boolean {
  if (match.status === 'skipped') return false;
  if (match.teamA.score === null || match.teamB.score === null) return false;
  return match.teamA.players.length >= 2 && match.teamB.players.length >= 2;
}

/**
 * CSV для импорта в DUPR: шапка как в их примере, без Notes.
 * Всегда doubles + SIDEOUT, один гейм; ExternalId оставляем пустыми.
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
        event,
        date,
        playerName(a1),
        playerDuprId(a1),
        '', // playerA1ExternalId
        playerName(a2),
        playerDuprId(a2),
        '', // playerA2ExternalId
        playerName(b1),
        playerDuprId(b1),
        '', // playerB1ExternalId
        playerName(b2),
        playerDuprId(b2),
        '', // playerB2ExternalId
        ...gameScores(match),
        location,
        'SIDEOUT',
      ]),
    );
  }

  return `${lines.join('\n')}\n`;
}
