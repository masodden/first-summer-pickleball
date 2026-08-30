import { describe, expect, it } from 'vitest';
import {
  classicSixPairBracket,
  classicTwelvePairBracket,
  displayStageName,
  gameSettingsForMatch,
  groupStagesByGames,
  isCompleteGame,
  knownSlotHeading,
  parseBracketConfig,
  seriesScoreIssue,
  slotHeading,
  validateBracketConfig,
} from './bracket.js';

describe('validateBracketConfig', () => {
  it('пресет 12 пар проходит', () => {
    const config = classicTwelvePairBracket();
    expect(validateBracketConfig(config)).toEqual([]);
    expect(config.groupCount).toBe(2);
    expect(config.stages).toHaveLength(10);
    expect(config.stages.flatMap((stage) => stage.slots)).toHaveLength(16);
  });

  it('пресет 6 пар проходит', () => {
    expect(validateBracketConfig(classicSixPairBracket())).toEqual([]);
  });

  it('без финала — ошибка', () => {
    const config = classicSixPairBracket();
    config.stages = config.stages.filter((stage) => stage.id !== 'final');
    expect(validateBracketConfig(config)).toContain('noFinal');
  });

  it('без матча за 3-е — ошибка', () => {
    const config = classicSixPairBracket();
    config.stages = config.stages.filter((stage) => stage.id !== 'bronze');
    expect(validateBracketConfig(config)).toContain('noThirdPlace');
  });

  it('пустые источники — ошибка', () => {
    const config = classicSixPairBracket();
    config.stages[0]!.slots[0]!.sourceA = '';
    expect(validateBracketConfig(config)).toContain('emptySources');
  });

  it('четвертьфинал не принимается за финал', () => {
    const config = classicSixPairBracket();
    config.stages.unshift({
      id: 'qf',
      kind: 'playoff',
      name: 'Четвертьфинал',
      games: config.stages[0]!.games,
      slots: [
        { id: 'qf1', sourceA: 'G1.1', sourceB: 'G2.2' },
        { id: 'qf2', sourceA: 'G2.1', sourceB: 'G1.2' },
        { id: 'qf3', sourceA: 'G3.1', sourceB: 'G4.2' },
        { id: 'qf4', sourceA: 'G4.1', sourceB: 'G3.2' },
      ],
    });
    expect(validateBracketConfig(config)).not.toContain('noFinal');
  });
});

describe('slotHeading', () => {
  it('одноматчевая стадия — имя круга, два полуфинала — с номером', () => {
    const config = classicSixPairBracket();
    expect(slotHeading(config, 'final')).toBe('Финал');
    expect(slotHeading(config, 'sf1')).toBe('Полуфинал 1');
    expect(slotHeading(config, 'sf2')).toBe('Полуфинал 2');
    expect(slotHeading(config, 'bronze')).toBe('За 3 место');
    expect(slotHeading(config, 'friendly')).toBe('Дружеский матч');
    expect(displayStageName('Полуфинал')).toBe('Полуфиналы');
    expect(displayStageName(config.stages[0]!.name)).toBe('Полуфиналы');
    expect(slotHeading(config, 'G1:a|b:c|d')).toBe('G1:a|b:c|d');
  });

  it('12 пар: четверти, полуфиналы и матчи за места', () => {
    const config = classicTwelvePairBracket();
    expect(slotHeading(config, 'qf1')).toBe('Четвертьфинал 1');
    expect(slotHeading(config, 'qf4')).toBe('Четвертьфинал 4');
    expect(slotHeading(config, 'sf2')).toBe('Полуфинал 2');
    expect(slotHeading(config, 'final')).toBe('Финал');
    expect(slotHeading(config, 'bronze')).toBe('За 3 место');
    expect(slotHeading(config, 'p912a')).toBe('За 9–12, матч 1');
    expect(slotHeading(config, 'p58b')).toBe('За 5–8, матч 2');
    expect(slotHeading(config, 'p5')).toBe('За 5 место');
    expect(slotHeading(config, 'p7')).toBe('За 7 место');
    expect(slotHeading(config, 'p9')).toBe('За 9 место');
    expect(slotHeading(config, 'p11')).toBe('За 11 место');
    expect(displayStageName(config.stages[0]!.name)).toBe('Четвертьфиналы');
    expect(knownSlotHeading(config, 'qf3')).toBe('Четвертьфинал 3');
    expect(
      gameSettingsForMatch(config, { stage: 'playoff', bracketSlot: 'qf1' }).pointsToWin,
    ).toBe(15);
    expect(
      gameSettingsForMatch(config, { stage: 'playoff', bracketSlot: 'sf1' }).pointsToWin,
    ).toBe(15);
    expect(
      gameSettingsForMatch(config, { stage: 'playoff', bracketSlot: 'final' }).winsToTake,
    ).toBe(2);
    expect(parseBracketConfig('fixed_pairs', null)?.groupCount).toBe(2);
    expect(
      gameSettingsForMatch(config, { stage: 'playoff', bracketSlot: 'sf1' }),
    ).not.toEqual(gameSettingsForMatch(config, { stage: 'playoff', bracketSlot: 'final' }));
    expect(
      groupStagesByGames(config.stages).map((bucket) => ({
        wins: bucket.games.winsToTake,
        points: bucket.games.pointsToWin,
      })),
    ).toEqual([
      { wins: 1, points: 15 },
      { wins: 2, points: 11 },
    ]);
  });

  it('полуфинал и финал хранят счёт и длину серии отдельно', () => {
    const config = classicTwelvePairBracket();
    const sf = config.stages.find((stage) => stage.id === 'sf')!;
    const final = config.stages.find((stage) => stage.id === 'final')!;
    sf.games = { winsToTake: 2, pointsToWin: 21, winByTwo: false };
    expect(final.games).toEqual({ winsToTake: 2, pointsToWin: 11, winByTwo: false });
    expect(gameSettingsForMatch(config, { stage: 'playoff', bracketSlot: 'sf1' })).toEqual(
      sf.games,
    );
    expect(gameSettingsForMatch(config, { stage: 'playoff', bracketSlot: 'final' })).toEqual(
      final.games,
    );
  });

  it('12 пар: источники идут волнами 6 / 6 / 4', () => {
    const config = classicTwelvePairBracket();
    const slots = config.stages.flatMap((stage) => stage.slots);
    expect(slots.map((slot) => slot.id)).toEqual([
      'qf1',
      'qf2',
      'qf3',
      'qf4',
      'p912a',
      'p912b',
      'sf1',
      'sf2',
      'p58a',
      'p58b',
      'p9',
      'p11',
      'final',
      'bronze',
      'p5',
      'p7',
    ]);
    expect(slots[0]).toMatchObject({ sourceA: 'G1.1', sourceB: 'G2.4' });
    expect(slots[2]).toMatchObject({ sourceA: 'G2.1', sourceB: 'G1.4' });
    expect(slots[6]).toMatchObject({ sourceA: 'qf1.W', sourceB: 'qf2.W' });
    expect(slots[12]).toMatchObject({ sourceA: 'sf1.W', sourceB: 'sf2.W' });
    expect(slots[13]).toMatchObject({ sourceA: 'sf1.L', sourceB: 'sf2.L' });
    expect(slots[14]).toMatchObject({ sourceA: 'p58a.W', sourceB: 'p58b.W' });
  });

  it('knownSlotHeading прячет групповые id', () => {
    const config = classicSixPairBracket();
    expect(knownSlotHeading(config, 'sf2')).toBe('Полуфинал 2');
    expect(knownSlotHeading(config, 'G1:a|b:c|d')).toBeNull();
  });
});

describe('isCompleteGame', () => {
  it('до 11 без разницы: 11:10 да, 3:2 нет, 12:8 нет', () => {
    const rules = { pointsToWin: 11, winByTwo: false };
    expect(isCompleteGame(11, 10, rules)).toBe(true);
    expect(isCompleteGame(3, 2, rules)).toBe(false);
    expect(isCompleteGame(12, 8, rules)).toBe(false);
    expect(isCompleteGame(11, 11, rules)).toBe(false);
  });

  it('до 11 с разницей в два: 11:9 да, 11:10 нет, 12:10 да', () => {
    const rules = { pointsToWin: 11, winByTwo: true };
    expect(isCompleteGame(11, 9, rules)).toBe(true);
    expect(isCompleteGame(11, 10, rules)).toBe(false);
    expect(isCompleteGame(12, 10, rules)).toBe(true);
    expect(isCompleteGame(15, 10, rules)).toBe(false);
  });
});

describe('seriesScoreIssue', () => {
  it('серия до двух побед готова на 11:5, 11:3', () => {
    const rules = { pointsToWin: 11, winByTwo: false, winsToTake: 2 };
    expect(
      seriesScoreIssue(
        [
          { scoreA: 11, scoreB: 5 },
          { scoreA: 11, scoreB: 3 },
          { scoreA: 0, scoreB: 0 },
        ],
        rules,
      ),
    ).toBeNull();
    expect(seriesScoreIssue([{ scoreA: 11, scoreB: 5 }], rules)).toBe('incomplete');
    expect(
      seriesScoreIssue(
        [
          { scoreA: 11, scoreB: 5 },
          { scoreA: 3, scoreB: 2 },
        ],
        rules,
      ),
    ).toBe('short');
  });
});
