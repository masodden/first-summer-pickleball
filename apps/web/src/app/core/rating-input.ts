/**
 * Поля рейтинга: `type="number"` в русской локали съедает точку и обнуляет ввод.
 * Держим text + inputmode=decimal и принимаем и `.`, и `,`.
 */

export function sanitizeRatingInput(raw: string): string {
  const normalized = raw.replaceAll(',', '.');
  let result = '';
  let seenDot = false;
  for (const ch of normalized) {
    if (ch >= '0' && ch <= '9') {
      result += ch;
      continue;
    }
    if (ch === '.' && !seenDot) {
      result += '.';
      seenDot = true;
    }
  }
  return result;
}

export function parseRatingInput(raw: string): number | null {
  const trimmed = sanitizeRatingInput(raw).trim();
  if (!trimmed || trimmed === '.') return null;
  const value = Number.parseFloat(trimmed);
  return Number.isFinite(value) ? value : null;
}
