/** UUID турнира в deep-link Telegram (`startapp=t_<uuid>`). */
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

/** Ссылка, которая открывает Mini App сразу на нужном турнире. */
export function tournamentMiniAppLink(botUsername: string, tournamentId: string): string {
  const user = botUsername.replace(/^@/, '');
  return `https://t.me/${user}?startapp=t_${tournamentId}`;
}
