/** Telegram HTML: иначе кавычки и имена с `<` ломают parse_mode. */
export function escapeTelegramHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function partnerLinkedByPlayerMessage(actorName: string, title: string): string {
  return `${escapeTelegramHtml(actorName)} заявился с вами на турнир «${escapeTelegramHtml(title)}».`;
}

export function partnerLinkedByOrganizerMessage(partnerName: string, title: string): string {
  return `Вы с ${escapeTelegramHtml(partnerName)} заявлены на турнир «${escapeTelegramHtml(title)}».`;
}

export function partnerUnlinkedByPlayerMessage(actorName: string, title: string): string {
  return `${escapeTelegramHtml(actorName)} расформировал пару. Чтобы заявиться на турнир «${escapeTelegramHtml(title)}», найдите себе другого игрока.`;
}

export function partnerUnlinkedByOrganizerMessage(title: string): string {
  return `Организатор расформировал вашу пару на турнире «${escapeTelegramHtml(title)}». Чтобы заявиться, найдите себе другого игрока.`;
}

const MOSCOW_TZ = 'Europe/Moscow';

/** «Воскресенье, 30 августа в 15:00» — клуб в Красногорске. */
export function formatTournamentWhen(startsAt: Date): string {
  const weekday = new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long',
    timeZone: MOSCOW_TZ,
  }).format(startsAt);
  const dayMonth = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    timeZone: MOSCOW_TZ,
  }).format(startsAt);
  const time = new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: MOSCOW_TZ,
  }).format(startsAt);
  const weekdayCap = weekday ? weekday.charAt(0).toUpperCase() + weekday.slice(1) : weekday;
  return `${weekdayCap}, ${dayMonth} в ${time}`;
}

export function participationConfirmedMessage(
  title: string,
  startsAt: Date,
  partnerName?: string | null,
): string {
  const safeTitle = escapeTelegramHtml(title);
  const lines = [
    `💵 Ваше участие в турнире «${safeTitle}» подтверждено, спасибо!`,
    `🕐 Ждём вас ${formatTournamentWhen(startsAt)} — битва будет эпичной!`,
  ];
  const partner = partnerName?.trim();
  if (partner) {
    lines.push(`👥 Вы в паре с ${escapeTelegramHtml(partner)}.`);
  }
  return lines.join('\n');
}

export interface RegistrationAnnounceInput {
  title: string;
  startsAt: Date;
  venueName?: string | null;
}

/** Рассылка клубу, пока открыта запись. */
export function registrationAnnounceMessage(input: RegistrationAnnounceInput): string {
  const title = escapeTelegramHtml(input.title);
  const lines = [
    `📣 <b>Идёт регистрация на «${title}»!</b>`,
    '',
    '⚡️ Успей записаться — места разбирают быстро.',
    '',
    `🕐 ${formatTournamentWhen(input.startsAt)}`,
  ];
  const venue = input.venueName?.trim();
  if (venue) lines.push(`📍 ${escapeTelegramHtml(venue)}`);
  return lines.join('\n');
}

export interface TournamentStartedInput {
  title: string;
  startsAt: Date;
  venueName?: string | null;
  venueAddress?: string | null;
  venueMapUrl?: string | null;
}

/** Пуш после старта: HTML + переносы, бот шлёт с parse_mode HTML. */
export function tournamentStartedMessage(input: TournamentStartedInput): string {
  const title = escapeTelegramHtml(input.title);
  const lines = [`⏰ Турнир «${title}» скоро начнётся`, ''];

  const venue = input.venueName?.trim();
  const address = input.venueAddress?.trim();
  if (venue) lines.push(`📍 ${escapeTelegramHtml(venue)}`);
  if (address && address !== venue) lines.push(escapeTelegramHtml(address));
  lines.push(`🕐 ${formatTournamentWhen(input.startsAt)}`);

  const mapUrl = input.venueMapUrl?.trim();
  if (mapUrl) {
    lines.push(`🗺 <a href="${escapeTelegramHtml(mapUrl)}">Открыть на карте</a>`);
  }

  lines.push('');
  lines.push(
    '🏃 Приезжайте за 15 минут до начала — успеете переодеться и размяться. Пожалуйста, не опаздывайте.',
  );
  lines.push('🏆 Свои игры можете прямо сейчас посмотреть в боте.');
  return lines.join('\n');
}

const MEDAL_ORDER = { gold: 0, silver: 1, bronze: 2 } as const;

/** Итог турнира в Telegram: у пар — оба имени, в порядке золото / серебро / бронза. */
export function tournamentFinishedMessage(
  title: string,
  teams: readonly {
    medal: 'gold' | 'silver' | 'bronze' | null;
    players: readonly { fullName: string }[];
  }[],
  standings: readonly {
    played: number;
    pointsFor: number;
    player: { fullName: string };
  }[],
): string {
  const safeTitle = escapeTelegramHtml(title);
  const pairLines = teams
    .filter((row) => row.medal)
    .sort((a, b) => (MEDAL_ORDER[a.medal!] ?? 9) - (MEDAL_ORDER[b.medal!] ?? 9))
    .map((row, index) => {
      const names = row.players.map((player) => escapeTelegramHtml(player.fullName)).join(' / ');
      return `${index + 1}. ${names}`;
    });
  const lines =
    pairLines.length > 0
      ? pairLines
      : standings
          .filter((row) => row.played > 0)
          .slice(0, 3)
          .map(
            (row, index) =>
              `${index + 1}. ${escapeTelegramHtml(row.player.fullName)} — ${row.pointsFor}`,
          );
  return lines.length > 0
    ? `Турнир «${safeTitle}» завершён.\n${lines.join('\n')}`
    : `Турнир «${safeTitle}» завершён.`;
}
