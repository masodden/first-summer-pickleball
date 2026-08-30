import { describe, expect, it } from 'vitest';
import {
  escapeTelegramHtml,
  formatTournamentWhen,
  partnerLinkedByOrganizerMessage,
  partnerLinkedByPlayerMessage,
  partnerUnlinkedByOrganizerMessage,
  partnerUnlinkedByPlayerMessage,
  participationConfirmedMessage,
  tournamentFinishedMessage,
  tournamentStartedMessage,
  registrationAnnounceMessage,
} from './copy.js';

describe('telegram copy', () => {
  it('экранирует HTML в именах и названии', () => {
    expect(escapeTelegramHtml('A & B <x>')).toBe('A &amp; B &lt;x&gt;');
    expect(partnerLinkedByPlayerMessage('Ann <x>', 'Open & Play')).toContain('Ann &lt;x&gt;');
    expect(partnerLinkedByPlayerMessage('Ann <x>', 'Open & Play')).toContain('Open &amp; Play');
  });

  it('игрок зовёт партнёра', () => {
    expect(partnerLinkedByPlayerMessage('Иван Петров', 'Осень')).toBe(
      'Иван Петров заявился с вами на турнир «Осень».',
    );
  });

  it('организатор собирает пару', () => {
    expect(partnerLinkedByOrganizerMessage('Мария Попов', 'Осень')).toBe(
      'Вы с Мария Попов заявлены на турнир «Осень».',
    );
  });

  it('игрок расформировал пару', () => {
    expect(partnerUnlinkedByPlayerMessage('Иван Петров', 'Осень')).toBe(
      'Иван Петров расформировал пару. Чтобы заявиться на турнир «Осень», найдите себе другого игрока.',
    );
  });

  it('организатор расформировал пару', () => {
    expect(partnerUnlinkedByOrganizerMessage('Осень')).toBe(
      'Организатор расформировал вашу пару на турнире «Осень». Чтобы заявиться, найдите себе другого игрока.',
    );
  });

  it('дата турнира по Москве: день недели, число и время', () => {
    expect(formatTournamentWhen(new Date('2026-08-30T12:00:00.000Z'))).toBe(
      'Воскресенье, 30 августа в 15:00',
    );
  });

  it('подтверждение оплаты: спасибо, дата, для пар — кто партнёр', () => {
    const startsAt = new Date('2026-08-30T12:00:00.000Z');
    expect(participationConfirmedMessage('Осень', startsAt)).toBe(
      [
        '💵 Ваше участие в турнире «Осень» подтверждено, спасибо!',
        '🕐 Ждём вас Воскресенье, 30 августа в 15:00 — битва будет эпичной!',
      ].join('\n'),
    );
    expect(participationConfirmedMessage('Осень', startsAt, 'Мария <x>')).toBe(
      [
        '💵 Ваше участие в турнире «Осень» подтверждено, спасибо!',
        '🕐 Ждём вас Воскресенье, 30 августа в 15:00 — битва будет эпичной!',
        '👥 Вы в паре с Мария &lt;x&gt;.',
      ].join('\n'),
    );
  });

  it('старт турнира: место, время, разминка, без состава', () => {
    const text = tournamentStartedMessage({
      title: 'Осень & финал',
      startsAt: new Date('2026-08-30T12:00:00.000Z'),
      venueName: 'Центр Пиклбола, Красногорск',
      venueAddress: 'Красногорск, Советская ул., 14',
      venueMapUrl: 'https://maps.example/place?q=1&2',
    });
    expect(text).toBe(
      [
        '⏰ Турнир «Осень &amp; финал» скоро начнётся',
        '',
        '📍 Центр Пиклбола, Красногорск',
        'Красногорск, Советская ул., 14',
        '🕐 Воскресенье, 30 августа в 15:00',
        '🗺 <a href="https://maps.example/place?q=1&amp;2">Открыть на карте</a>',
        '',
        '🏃 Приезжайте за 15 минут до начала — успеете переодеться и размяться. Пожалуйста, не опаздывайте.',
        '🏆 Свои игры можете прямо сейчас посмотреть в боте.',
      ].join('\n'),
    );
    expect(text).not.toContain('состав');
  });

  it('рассылка записи: регистрация, дата и площадка', () => {
    expect(
      registrationAnnounceMessage({
        title: 'Осень & финал',
        startsAt: new Date('2026-08-30T12:00:00.000Z'),
        venueName: 'Центр Пиклбола, Красногорск',
      }),
    ).toBe(
      [
        '📣 <b>Идёт регистрация на «Осень &amp; финал»!</b>',
        '',
        '⚡️ Успей записаться — места разбирают быстро.',
        '',
        '🕐 Воскресенье, 30 августа в 15:00',
        '📍 Центр Пиклбола, Красногорск',
      ].join('\n'),
    );
  });

  it('финиш парного турнира называет обоих в паре, в порядке медалей', () => {
    const text = tournamentFinishedMessage(
      'Осень',
      [
        {
          medal: 'bronze',
          players: [{ fullName: 'C' }, { fullName: 'D' }],
        },
        {
          medal: 'gold',
          players: [{ fullName: 'Ann <x>' }, { fullName: 'Bob' }],
        },
        {
          medal: 'silver',
          players: [{ fullName: 'E' }, { fullName: 'F' }],
        },
      ],
      [],
    );
    expect(text).toBe(
      'Турнир «Осень» завершён.\n1. Ann &lt;x&gt; / Bob\n2. E / F\n3. C / D',
    );
  });
});
