import { Injectable } from '@angular/core';

export const TOURNAMENT_TABS = ['info', 'players', 'rounds', 'standings'] as const;
export type TournamentTab = (typeof TOURNAMENT_TABS)[number];

const TAB_KEY = 'fsp.tournamentTab';
const ROUND_KEY = 'fsp.tournamentRound';

/**
 * Где организатор остановился.
 *
 * На площадке два турнира идут параллельно, и человек прыгает между ними весь
 * вечер. Открывать каждый раз «Информацию» и первый раунд — значит заставлять
 * его каждый раз возвращаться туда, где он только что был. Поэтому запоминаем
 * вкладку (одну на все турниры: рука тянется к тому же месту) и раунд для
 * каждого турнира отдельно.
 *
 * Живёт в localStorage: Mini App перезагружается вместе с Telegram, а память
 * должна переживать перезапуск.
 */
@Injectable({ providedIn: 'root' })
export class ViewStateService {
  private readonly rounds = new Map<string, number>(this.readRounds());

  lastTab(): TournamentTab {
    const raw = read(TAB_KEY);
    return isTab(raw) ? raw : 'info';
  }

  setLastTab(tab: string): void {
    if (!isTab(tab)) return;
    write(TAB_KEY, tab);
  }

  lastRound(tournamentId: string): number | null {
    return this.rounds.get(tournamentId) ?? null;
  }

  setLastRound(tournamentId: string, index: number): void {
    this.rounds.set(tournamentId, index);
    // Держим только последние турниры: на площадке важны сегодняшние.
    const entries = [...this.rounds.entries()].slice(-12);
    this.rounds.clear();
    for (const [id, value] of entries) this.rounds.set(id, value);
    write(ROUND_KEY, JSON.stringify(entries));
  }

  private readRounds(): [string, number][] {
    const raw = read(ROUND_KEY);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (entry): entry is [string, number] =>
          Array.isArray(entry) &&
          typeof entry[0] === 'string' &&
          typeof entry[1] === 'number' &&
          Number.isInteger(entry[1]),
      );
    } catch {
      return [];
    }
  }
}

function isTab(value: string | null): value is TournamentTab {
  return value !== null && (TOURNAMENT_TABS as readonly string[]).includes(value);
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Память между сессиями — удобство, а не условие работы.
  }
}
