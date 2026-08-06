/** UUID в deep-link Telegram (`t_<uuid>`, `tr_<uuid>`). */
const ENTITY_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isTournamentId(value: string): boolean {
  return ENTITY_ID.test(value);
}

export function isTrainingId(value: string): boolean {
  return ENTITY_ID.test(value);
}

/**
 * Достаёт id турнира из Telegram `start_param` или из `?tournament=` в URL
 * (кнопка бота после /start). `tr_` — тренировки, их тут не трогаем.
 */
export function readTournamentDeepLink(startParam: string | null): string | null {
  if (startParam?.startsWith('tr_')) return null;
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

/** Достаёт id тренировки из `tr_<uuid>` или `?training=`. */
export function readTrainingDeepLink(startParam: string | null): string | null {
  if (startParam?.startsWith('tr_')) {
    const id = startParam.slice(3);
    if (isTrainingId(id)) return id;
  }

  try {
    const fromQuery = new URLSearchParams(window.location.search).get('training');
    if (fromQuery && isTrainingId(fromQuery)) return fromQuery;
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

function miniAppLink(
  botUsername: string,
  payload: string,
  options: TournamentLinkOptions = {},
): string {
  const user = botUsername.replace(/^@/, '');
  const short = options.shortName?.replace(/^\/+|\/+$/g, '');
  if (short) {
    return `https://t.me/${user}/${short}?startapp=${payload}`;
  }
  return `https://t.me/${user}?start=${payload}`;
}

/** Ссылка, которая приводит игрока к выбранному турниру в боте. */
export function tournamentMiniAppLink(
  botUsername: string,
  tournamentId: string,
  options: TournamentLinkOptions = {},
): string {
  return miniAppLink(botUsername, `t_${tournamentId}`, options);
}

/** Ссылка на тренировку в боте. */
export function trainingMiniAppLink(
  botUsername: string,
  trainingId: string,
  options: TournamentLinkOptions = {},
): string {
  return miniAppLink(botUsername, `tr_${trainingId}`, options);
}
