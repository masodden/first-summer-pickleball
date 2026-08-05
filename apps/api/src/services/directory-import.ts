import { gunzipSync } from 'node:zlib';
import { eq, inArray } from 'drizzle-orm';
import { RATING_MAX, RATING_MIN, isValidDuprId, normalizeDuprId } from '@fsp/shared';
import type { ImportReportDto } from '@fsp/shared';
import type { Database } from '../db/index.js';
import { playerRatingHistory, players } from '../db/schema.js';

export interface DirectoryEntry {
  duprId: string;
  firstName: string;
  lastName: string;
  doublesRating: number | null;
  singlesRating: number | null;
}

/** Рейтинг в выгрузках приходит строкой, а «NR» означает отсутствие рейтинга. */
function parseRating(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (text === '' || text.toUpperCase() === 'NR' || text === '-' || text === '—') return null;
  const value = Number.parseFloat(text.replace(',', '.'));
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value * 1000) / 1000;
  if (rounded < RATING_MIN || rounded > RATING_MAX) return null;
  return rounded;
}

/** В выгрузках фамилия стоит последней, всё остальное считаем именем. */
export function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return { firstName: 'Игрок', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0] as string, lastName: '' };
  const lastName = parts[parts.length - 1] as string;
  return { firstName: parts.slice(0, -1).join(' '), lastName };
}

function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',' || char === ';' || char === '\t') {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function parseCsv(content: string): DirectoryEntry[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0] as string).map(normalizeHeader);
  const columnOf = (...candidates: string[]): number =>
    headers.findIndex((header) => candidates.includes(header));

  const duprColumn = columnOf('duprid', 'dupr', 'id');
  const nameColumn = columnOf('name', 'playersname', 'fullname', 'runame', 'имяигрока');
  const firstColumn = columnOf('firstname', 'first', 'имя');
  const lastColumn = columnOf('lastname', 'last', 'surname', 'фамилия');
  const doublesColumn = columnOf('doubles', 'doublesrating', 'dupdoubles', 'парный');
  const singlesColumn = columnOf('singles', 'singlesrating', 'одиночный');

  const entries: DirectoryEntry[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const rawDupr = duprColumn >= 0 ? (cells[duprColumn] ?? '') : '';
    const duprId = normalizeDuprId(rawDupr);
    if (!isValidDuprId(duprId)) continue;

    let firstName = firstColumn >= 0 ? (cells[firstColumn] ?? '') : '';
    let lastName = lastColumn >= 0 ? (cells[lastColumn] ?? '') : '';
    if (!firstName && !lastName && nameColumn >= 0) {
      const split = splitName(cells[nameColumn] ?? '');
      firstName = split.firstName;
      lastName = split.lastName;
    }
    if (!firstName && !lastName) continue;

    entries.push({
      duprId,
      firstName: firstName || 'Игрок',
      lastName,
      doublesRating: doublesColumn >= 0 ? parseRating(cells[doublesColumn]) : null,
      singlesRating: singlesColumn >= 0 ? parseRating(cells[singlesColumn]) : null,
    });
  }
  return entries;
}

interface RawJsonPlayer {
  name?: string;
  'ru-name'?: string;
  ruName?: string;
  firstName?: string;
  lastName?: string;
  duprId?: string;
  dupr?: string;
  doubles?: unknown;
  singles?: unknown;
  doublesRating?: unknown;
  singlesRating?: unknown;
}

function parseJsonPlayers(raw: unknown): DirectoryEntry[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'object' &&
        raw !== null &&
        Array.isArray((raw as { players?: unknown }).players)
      ? (raw as { players: unknown[] }).players
      : [];

  const entries: DirectoryEntry[] = [];
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const player = item as RawJsonPlayer;
    const duprId = normalizeDuprId(player.duprId ?? player.dupr ?? '');
    if (!isValidDuprId(duprId)) continue;

    let firstName = player.firstName ?? '';
    let lastName = player.lastName ?? '';
    if (!firstName && !lastName) {
      // Русское написание приоритетнее: интерфейс по умолчанию на русском.
      const display = player['ru-name'] ?? player.ruName ?? player.name ?? '';
      const split = splitName(display);
      firstName = split.firstName;
      lastName = split.lastName;
    }
    if (!firstName && !lastName) continue;

    entries.push({
      duprId,
      firstName: firstName || 'Игрок',
      lastName,
      doublesRating: parseRating(player.doubles ?? player.doublesRating),
      singlesRating: parseRating(player.singles ?? player.singlesRating),
    });
  }
  return entries;
}

/**
 * Понимает три формата: `players.js` со сжатым base64 (как в публичной выгрузке
 * русскоязычных игроков), обычный JSON и CSV.
 */
export function parseDirectory(content: string): DirectoryEntry[] {
  const trimmed = content.trim();

  const gzipMatch = /playersDataGzipBase64\s*=\s*['"`]([A-Za-z0-9+/=\s]+)['"`]/.exec(trimmed);
  if (gzipMatch?.[1]) {
    const base64 = gzipMatch[1].replace(/\s+/g, '');
    const json = gunzipSync(Buffer.from(base64, 'base64')).toString('utf8');
    return parseJsonPlayers(JSON.parse(json));
  }

  const plainMatch = /playersData\s*=\s*(\[[\s\S]*?\]);?\s*$/.exec(trimmed);
  if (plainMatch?.[1]) {
    return parseJsonPlayers(JSON.parse(plainMatch[1]));
  }

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return parseJsonPlayers(JSON.parse(trimmed));
  }

  return parseCsv(trimmed);
}

export interface ImportOptions {
  /** Кто запустил импорт: попадёт в историю рейтинга. */
  accountId?: string | null;
  actorName?: string | null;
}

/**
 * Заливает справочник в базу.
 *
 * Сопоставление идёт по DUPR ID, поэтому дубликаты невозможны. Ручные правки
 * защищены: если рейтинг ставили руками и в выгрузке другое значение, оно
 * попадает в `pendingImportRating` и ждёт решения модератора.
 */
export async function importDirectory(
  db: Database,
  entries: readonly DirectoryEntry[],
  options: ImportOptions = {},
): Promise<ImportReportDto> {
  const report: ImportReportDto = {
    created: 0,
    updated: 0,
    conflicts: 0,
    skipped: 0,
    total: entries.length,
  };
  if (entries.length === 0) return report;

  const unique = new Map<string, DirectoryEntry>();
  for (const entry of entries) {
    unique.set(entry.duprId, entry);
  }
  const ids = [...unique.keys()];
  const now = new Date();

  const CHUNK = 500;
  for (let offset = 0; offset < ids.length; offset += CHUNK) {
    const chunk = ids.slice(offset, offset + CHUNK);
    const existing = await db.select().from(players).where(inArray(players.id, chunk));
    const existingById = new Map(existing.map((row) => [row.id, row]));

    for (const id of chunk) {
      const entry = unique.get(id) as DirectoryEntry;
      const current = existingById.get(id);

      if (!current) {
        await db.insert(players).values({
          id: entry.duprId,
          duprId: entry.duprId,
          firstName: entry.firstName,
          lastName: entry.lastName,
          doublesRating: entry.doublesRating,
          singlesRating: entry.singlesRating,
          ratingUpdatedAt: entry.doublesRating === null ? null : now,
          ratingSource: entry.doublesRating === null ? null : 'import',
          nameSource: 'import',
        });
        if (entry.doublesRating !== null) {
          await db.insert(playerRatingHistory).values({
            playerId: entry.duprId,
            previousRating: null,
            rating: entry.doublesRating,
            source: 'import',
            changedByAccountId: options.accountId ?? null,
            changedByName: options.actorName ?? 'Импорт справочника',
          });
        }
        report.created += 1;
        continue;
      }

      const patch: Partial<typeof players.$inferInsert> = {};
      let touched = false;

      // Имя обновляем только если его не правили руками.
      if (
        current.nameSource === 'import' &&
        (current.firstName !== entry.firstName || current.lastName !== entry.lastName)
      ) {
        patch.firstName = entry.firstName;
        patch.lastName = entry.lastName;
        touched = true;
      }

      if (entry.singlesRating !== null && current.singlesRating !== entry.singlesRating) {
        patch.singlesRating = entry.singlesRating;
        touched = true;
      }

      const manualRating = current.ratingSource === 'moderator' || current.ratingSource === 'self';
      const ratingDiffers =
        entry.doublesRating !== null && current.doublesRating !== entry.doublesRating;

      if (ratingDiffers && manualRating) {
        // Не перетираем ручное значение: показываем расхождение модератору.
        if (current.pendingImportRating !== entry.doublesRating) {
          patch.pendingImportRating = entry.doublesRating;
          touched = true;
        }
        report.conflicts += 1;
      } else if (ratingDiffers) {
        patch.doublesRating = entry.doublesRating;
        patch.ratingUpdatedAt = now;
        patch.ratingSource = 'import';
        patch.pendingImportRating = null;
        touched = true;
        await db.insert(playerRatingHistory).values({
          playerId: current.id,
          previousRating: current.doublesRating,
          rating: entry.doublesRating,
          source: 'import',
          changedByAccountId: options.accountId ?? null,
          changedByName: options.actorName ?? 'Импорт справочника',
        });
      }

      if (touched) {
        patch.updatedAt = now;
        await db.update(players).set(patch).where(eq(players.id, current.id));
        report.updated += 1;
      } else {
        report.skipped += 1;
      }
    }
  }

  return report;
}
