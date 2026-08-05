/** UUID турнира в deep-link Telegram (`t_<uuid>`). */
const TOURNAMENT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isTournamentId(value: string): boolean {
  return TOURNAMENT_ID.test(value);
}

/**
 * Достаёт id турнира из Telegram `start_param` или из `?tournament=` в URL
 * (кнопка бота после /start).
 */
export function readTournamentDeepLink(startParam: string | null): string | null {
  if (startParam?.startsWith('t_')) {
    const id = startParam.slice(2);
    if (isTournamentId(id)) return id;
  }

  try {
    const fromQuery = new URLSearchParams(window.location.search).get('tournament');
    if (fromQuery && isTournamentId(fromQuery)) return fromQuery;
  } catch {
    // ignore
  }

  return null;
}

export interface TournamentLinkOptions {
  /**
   * Short name Mini App из BotFather (`/newapp`).
   * Тогда ссылка вида t.me/bot/app?startapp=… открывает приложение сразу.
   * Без него используем t.me/bot?start=… — бот пришлёт кнопку «Открыть».
   */
  shortName?: string | null;
}

/** Ссылка, которая приводит игрока к выбранному турниру в боте. */
export function tournamentMiniAppLink(
  botUsername: string,
  tournamentId: string,
  options: TournamentLinkOptions = {},
): string {
  const user = botUsername.replace(/^@/, '');
  const payload = `t_${tournamentId}`;
  const short = options.shortName?.replace(/^\/+|\/+$/g, '');
  if (short) {
    return `https://t.me/${user}/${short}?startapp=${payload}`;
  }
  // startapp без Main Mini App /newapp часто просто открывает чат бота без приложения.
  return `https://t.me/${user}?start=${payload}`;
}
