/** Стадия сетки фиксированных пар. */
export const BRACKET_STAGE_KINDS = ['group', 'playoff', 'consolation'] as const;
export type BracketStageKind = (typeof BRACKET_STAGE_KINDS)[number];

export interface BracketGameSettings {
  /** 1 — один гейм, 2 — до двух побед (best of 3). */
  winsToTake: number;
  pointsToWin: number;
  winByTwo: boolean;
}

export interface BracketSlot {
  id: string;
  /** Источник стороны A: `G1.1`, `sf1.W`, `sf1.L`. */
  sourceA: string;
  sourceB: string;
}

export interface BracketStage {
  id: string;
  kind: Exclude<BracketStageKind, 'group'>;
  name: string;
  games: BracketGameSettings;
  slots: BracketSlot[];
}

export interface BracketConfig {
  groupCount: number;
  groupMatchesPerPairing: number;
  groupGames: BracketGameSettings;
  stages: BracketStage[];
  /** Пара (канонический id) → индекс группы 0-based. Пусто — змейка при старте. */
  pairGroups?: Record<string, number>;
}

export function defaultGameSettings(pointsToWin = 11, winByTwo = false): BracketGameSettings {
  return { winsToTake: 1, pointsToWin, winByTwo };
}

export function seriesGameSettings(pointsToWin = 11, winByTwo = false): BracketGameSettings {
  return { winsToTake: 2, pointsToWin, winByTwo };
}

/** Канонический id пары: два playerId в лексикографическом порядке. */
export function pairId(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function pairPlayers(id: string): [string, string] | null {
  const [left, right] = id.split('|');
  if (!left || !right) return null;
  return [left, right];
}

/**
 * Пресет 1: 12 пар, 2 группы. Группа до 11, четверти/полуфиналы/места до 15,
 * финал и 3-е — серия до двух побед по 11. Порядок стадий задаёт корты:
 * титульные матчи занимают первые корты волны.
 */
export function classicTwelvePairBracket(winByTwo = false): BracketConfig {
  const group = defaultGameSettings(11, winByTwo);
  const to15 = defaultGameSettings(15, winByTwo);
  const series = seriesGameSettings(11, winByTwo);
  return {
    groupCount: 2,
    groupMatchesPerPairing: 1,
    groupGames: group,
    stages: [
      {
        id: 'qf',
        kind: 'playoff',
        name: 'Четвертьфиналы',
        games: to15,
        slots: [
          { id: 'qf1', sourceA: 'G1.1', sourceB: 'G2.4' },
          { id: 'qf2', sourceA: 'G1.2', sourceB: 'G2.3' },
          { id: 'qf3', sourceA: 'G2.1', sourceB: 'G1.4' },
          { id: 'qf4', sourceA: 'G2.2', sourceB: 'G1.3' },
        ],
      },
      {
        id: 'p912sf',
        kind: 'consolation',
        name: 'За 9–12 места',
        games: to15,
        slots: [
          { id: 'p912a', sourceA: 'G1.5', sourceB: 'G2.6' },
          { id: 'p912b', sourceA: 'G2.5', sourceB: 'G1.6' },
        ],
      },
      {
        id: 'sf',
        kind: 'playoff',
        name: 'Полуфиналы',
        games: to15,
        slots: [
          { id: 'sf1', sourceA: 'qf1.W', sourceB: 'qf2.W' },
          { id: 'sf2', sourceA: 'qf3.W', sourceB: 'qf4.W' },
        ],
      },
      {
        id: 'p58sf',
        kind: 'consolation',
        name: 'За 5–8 места',
        games: to15,
        slots: [
          { id: 'p58a', sourceA: 'qf1.L', sourceB: 'qf2.L' },
          { id: 'p58b', sourceA: 'qf3.L', sourceB: 'qf4.L' },
        ],
      },
      {
        id: 'p9',
        kind: 'consolation',
        name: 'За 9 место',
        games: to15,
        slots: [{ id: 'p9', sourceA: 'p912a.W', sourceB: 'p912b.W' }],
      },
      {
        id: 'p11',
        kind: 'consolation',
        name: 'За 11 место',
        games: to15,
        slots: [{ id: 'p11', sourceA: 'p912a.L', sourceB: 'p912b.L' }],
      },
      {
        id: 'final',
        kind: 'playoff',
        name: 'Финал',
        games: series,
        slots: [{ id: 'final', sourceA: 'sf1.W', sourceB: 'sf2.W' }],
      },
      {
        id: 'bronze',
        kind: 'playoff',
        name: 'За 3 место',
        games: series,
        slots: [{ id: 'bronze', sourceA: 'sf1.L', sourceB: 'sf2.L' }],
      },
      {
        id: 'p5',
        kind: 'consolation',
        name: 'За 5 место',
        games: to15,
        slots: [{ id: 'p5', sourceA: 'p58a.W', sourceB: 'p58b.W' }],
      },
      {
        id: 'p7',
        kind: 'consolation',
        name: 'За 7 место',
        games: to15,
        slots: [{ id: 'p7', sourceA: 'p58a.L', sourceB: 'p58b.L' }],
      },
    ],
  };
}

/** Пресет 2: 6 пар, 1 группа, 1–4 плей-офф, 5–6 дружеский, финал и за 3-е. */
export function classicSixPairBracket(pointsToWin = 11, winByTwo = false): BracketConfig {
  const series = seriesGameSettings(pointsToWin, winByTwo);
  return {
    groupCount: 1,
    groupMatchesPerPairing: 1,
    groupGames: defaultGameSettings(pointsToWin, winByTwo),
    stages: [
      {
        id: 'sf',
        kind: 'playoff',
        name: 'Полуфиналы',
        games: series,
        slots: [
          { id: 'sf1', sourceA: 'G1.1', sourceB: 'G1.4' },
          { id: 'sf2', sourceA: 'G1.2', sourceB: 'G1.3' },
        ],
      },
      {
        id: 'final',
        kind: 'playoff',
        name: 'Финал',
        games: series,
        slots: [{ id: 'final', sourceA: 'sf1.W', sourceB: 'sf2.W' }],
      },
      {
        id: 'bronze',
        kind: 'playoff',
        name: 'За 3 место',
        games: series,
        slots: [{ id: 'bronze', sourceA: 'sf1.L', sourceB: 'sf2.L' }],
      },
      {
        id: 'friendly',
        kind: 'consolation',
        name: 'Дружеский матч',
        games: series,
        slots: [{ id: 'friendly', sourceA: 'G1.5', sourceB: 'G1.6' }],
      },
    ],
  };
}

export function emptyBracketConfig(pointsToWin = 11): BracketConfig {
  return {
    groupCount: 1,
    groupMatchesPerPairing: 1,
    groupGames: defaultGameSettings(pointsToWin, false),
    stages: [],
  };
}

export function isBracketConfig(value: unknown): value is BracketConfig {
  if (!value || typeof value !== 'object') return false;
  const row = value as BracketConfig;
  return (
    typeof row.groupCount === 'number' &&
    typeof row.groupMatchesPerPairing === 'number' &&
    Array.isArray(row.stages)
  );
}

export function parseBracketConfig(
  format: string,
  value: unknown,
  pointsToWin = 11,
): BracketConfig | null {
  if (format !== 'fixed_pairs') return null;
  return isBracketConfig(value) ? value : classicTwelvePairBracket();
}

export function sameGameSettings(left: BracketGameSettings, right: BracketGameSettings): boolean {
  return (
    left.winsToTake === right.winsToTake &&
    left.pointsToWin === right.pointsToWin &&
    left.winByTwo === right.winByTwo
  );
}

/** Стадии с одинаковым счётом и длиной серии — одной строкой в описании. */
export function groupStagesByGames(
  stages: readonly BracketStage[],
): { names: string[]; games: BracketGameSettings }[] {
  const buckets: { names: string[]; games: BracketGameSettings }[] = [];
  for (const stage of stages) {
    const existing = buckets.find((bucket) => sameGameSettings(bucket.games, stage.games));
    if (existing) existing.names.push(displayStageName(stage.name));
    else buckets.push({ names: [displayStageName(stage.name)], games: stage.games });
  }
  return buckets;
}

export function gameSettingsForMatch(
  config: BracketConfig | null,
  match: { stage?: string | null; bracketSlot?: string | null },
): BracketGameSettings {
  if (!config) return defaultGameSettings();
  if (match.stage === 'playoff' || match.stage === 'consolation') {
    for (const stage of config.stages) {
      if (stage.slots.some((slot) => slot.id === match.bracketSlot)) return stage.games;
    }
  }
  return config.groupGames;
}

/** Сколько мест в каждой группе, исходя из лимита людей. */
export function placesPerGroup(maxPlayers: number, groupCount: number): number {
  const pairs = Math.max(2, Math.floor(Math.max(4, maxPlayers) / 2));
  return Math.max(2, Math.ceil(pairs / Math.max(1, groupCount)));
}

/** Источники из таблицы группы: `G1.1` — 1-е место первой группы. */
export function groupSourceTokens(groupCount: number, places: number): string[] {
  const tokens: string[] = [];
  for (let group = 1; group <= groupCount; group += 1) {
    for (let place = 1; place <= places; place += 1) {
      tokens.push(`G${group}.${place}`);
    }
  }
  return tokens;
}

/** Победитель / проигравший уже описанных матчей: `sf1.W`, `sf1.L`. */
export function outcomeSourceTokens(stages: readonly BracketStage[]): string[] {
  return stages.flatMap((stage) =>
    stage.slots.flatMap((slot) => [`${slot.id}.W`, `${slot.id}.L`]),
  );
}

/** Старые сетки: «Дружеский», «Полуфинал» в единственном числе. */
export function displayStageName(name: string): string {
  if (name === 'Дружеский') return 'Дружеский матч';
  if (name === 'Friendly') return 'Friendly match';
  if (name === 'Полуфинал') return 'Полуфиналы';
  if (name === 'Semifinal') return 'Semifinals';
  if (name === 'Четвертьфинал') return 'Четвертьфиналы';
  if (name === 'Quarterfinal') return 'Quarterfinals';
  return name;
}

function numberedSlotName(name: string): string {
  if (name === 'Полуфиналы' || name === 'Полуфинал') return 'Полуфинал';
  if (name === 'Semifinals' || name === 'Semifinal') return 'Semifinal';
  if (name === 'Четвертьфиналы' || name === 'Четвертьфинал') return 'Четвертьфинал';
  if (name === 'Quarterfinals' || name === 'Quarterfinal') return 'Quarterfinal';
  const compact = name.replace(/\s+/g, '').toLowerCase();
  if (compact.includes('5–8') || compact.includes('5-8')) return 'За 5–8, матч';
  if (compact.includes('9–12') || compact.includes('9-12')) return 'За 9–12, матч';
  if (/5th.?8th/i.test(name)) return '5th–8th, match';
  if (/9th.?12th/i.test(name)) return '9th–12th, match';
  return displayStageName(name);
}

/** Подпись слота без внутренних id: «Финал», «Полуфинал 2». */
export function slotHeading(config: BracketConfig, slotId: string): string {
  for (const stage of config.stages) {
    const index = stage.slots.findIndex((slot) => slot.id === slotId);
    if (index === -1) continue;
    if (stage.slots.length === 1) return displayStageName(stage.name);
    return `${numberedSlotName(stage.name)} ${index + 1}`;
  }
  return slotId;
}

/** Как slotHeading, но null для групповых служебных id вроде `G1:…`. */
export function knownSlotHeading(config: BracketConfig, slotId: string): string | null {
  const known = config.stages.some((stage) => stage.slots.some((slot) => slot.id === slotId));
  return known ? slotHeading(config, slotId) : null;
}

export type GameScoreIssue = 'tie' | 'short' | 'winByTwo' | 'over';

/** Почему гейм ещё нельзя сохранить: 3:2 при игре до 11, 11:10 при win-by-two и т.п. */
export function gameScoreIssue(
  scoreA: number,
  scoreB: number,
  options: { pointsToWin: number; winByTwo: boolean },
): GameScoreIssue | null {
  if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0) {
    return 'short';
  }
  if (scoreA === scoreB) return 'tie';
  const max = Math.max(scoreA, scoreB);
  const min = Math.min(scoreA, scoreB);
  const { pointsToWin, winByTwo } = options;
  if (max < pointsToWin) return 'short';
  if (winByTwo) {
    if (max - min < 2) return 'winByTwo';
    if (max > pointsToWin && max - min !== 2) return 'winByTwo';
    return null;
  }
  if (max !== pointsToWin || min >= pointsToWin) return 'over';
  return null;
}

export function isCompleteGame(
  scoreA: number,
  scoreB: number,
  options: { pointsToWin: number; winByTwo: boolean },
): boolean {
  return gameScoreIssue(scoreA, scoreB, options) === null;
}

/** Серия до N побед: все сыгранные геймы валидны и кто-то уже набрал N. */
export function seriesScoreIssue(
  games: readonly { scoreA: number; scoreB: number }[],
  options: { pointsToWin: number; winByTwo: boolean; winsToTake: number },
): GameScoreIssue | 'incomplete' | 'extra' | null {
  let winsA = 0;
  let winsB = 0;
  let done = false;
  for (const game of games) {
    const empty = game.scoreA === 0 && game.scoreB === 0;
    if (done) {
      if (!empty) return 'extra';
      continue;
    }
    if (empty) return 'incomplete';
    const issue = gameScoreIssue(game.scoreA, game.scoreB, options);
    if (issue) return issue;
    if (game.scoreA > game.scoreB) winsA += 1;
    else winsB += 1;
    if (winsA === options.winsToTake || winsB === options.winsToTake) done = true;
  }
  return done ? null : 'incomplete';
}

export const BRACKET_ISSUE_IDS = [
  'emptySources',
  'duplicateSources',
  'noFinal',
  'noThirdPlace',
] as const;
export type BracketIssueId = (typeof BRACKET_ISSUE_IDS)[number];

function outcomeSide(token: string): 'W' | 'L' | null {
  const match = /\.(W|L)$/.exec(token);
  return match ? (match[1] as 'W' | 'L') : null;
}

function groupPlaceNumber(token: string): number | null {
  const dotted = /^G\d+\.(\d+)$/.exec(token);
  if (dotted) return Number(dotted[1]);
  const letter = /^[A-Z](\d+)$/.exec(token);
  return letter ? Number(letter[1]) : null;
}

function slotPlaces(slot: BracketSlot): [number, number] | null {
  const a = groupPlaceNumber(slot.sourceA);
  const b = groupPlaceNumber(slot.sourceB);
  if (a === null || b === null) return null;
  return [a, b];
}

function looksLikeFinalName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (/полуфинал|четвертьфинал|semi|quarter/i.test(normalized)) return false;
  return /финал|final/i.test(normalized);
}

function looksLikeThirdName(name: string): boolean {
  return /3\s*место|треть|бронз|bronze/i.test(name);
}

/** Проверка сетки перед стартом: финал, матч за 3-е, заполненные уникальные источники. */
export function validateBracketConfig(config: BracketConfig): BracketIssueId[] {
  const issues: BracketIssueId[] = [];
  const sources = config.stages.flatMap((stage) =>
    stage.slots.flatMap((slot) => [slot.sourceA, slot.sourceB]),
  );
  if (config.stages.length === 0 || sources.some((token) => !token.trim())) {
    issues.push('emptySources');
  }
  const filled = sources.filter((token) => token.trim());
  if (new Set(filled).size !== filled.length) {
    issues.push('duplicateSources');
  }

  const playoff = config.stages.filter((stage) => stage.kind === 'playoff');
  const playoffSlots = playoff.flatMap((stage) => stage.slots);
  const hasFinal =
    playoff.some((stage) => looksLikeFinalName(stage.name)) ||
    playoffSlots.some(
      (slot) => outcomeSide(slot.sourceA) === 'W' && outcomeSide(slot.sourceB) === 'W',
    ) ||
    playoffSlots.some((slot) => {
      const places = slotPlaces(slot);
      if (!places) return false;
      const [left, right] = places;
      return (
        (left === 1 && right === 1) || (left === 1 && right === 2) || (left === 2 && right === 1)
      );
    });
  const hasThirdPlace =
    playoff.some((stage) => looksLikeThirdName(stage.name)) ||
    playoffSlots.some(
      (slot) => outcomeSide(slot.sourceA) === 'L' && outcomeSide(slot.sourceB) === 'L',
    ) ||
    playoffSlots.some((slot) => {
      const places = slotPlaces(slot);
      if (!places) return false;
      const [left, right] = places;
      return (left === 2 && right === 2) || (left >= 3 && right >= 3);
    });

  if (!hasFinal) issues.push('noFinal');
  if (!hasThirdPlace) issues.push('noThirdPlace');
  return issues;
}
