import type { FastifyInstance } from 'fastify';
import { WS_PATH, type ClientEvent } from '@fsp/shared';
import { pushTournamentSnapshot } from '../realtime/broadcast.js';
import type { AppContext } from './context.js';

/**
 * Один WebSocket на клиент, подписки — по турнирам.
 *
 * Соединение доступно и наблюдателям без входа: живое табло должно работать
 * без авторизации. После `subscribe` сразу уходит снимок раундов: иначе второй
 * телефон после обрыва сети остаётся со старым «раунд ещё идёт».
 */
export function registerWebsocket(app: FastifyInstance, ctx: AppContext): void {
  const { db, hub } = ctx;

  app.get(WS_PATH, { websocket: true }, (socket) => {
    hub.send(socket, { type: 'hello', serverTime: new Date().toISOString() });

    socket.on('message', (raw: Buffer | string) => {
      let event: ClientEvent;
      try {
        event = JSON.parse(raw.toString()) as ClientEvent;
      } catch {
        return;
      }

      switch (event.type) {
        case 'subscribe':
          if (typeof event.tournamentId === 'string' && event.tournamentId.length > 0) {
            hub.subscribe(socket, event.tournamentId);
            hub.send(socket, { type: 'subscribed', tournamentId: event.tournamentId });
            void pushTournamentSnapshot(db, hub, socket, event.tournamentId);
          }
          break;
        case 'unsubscribe':
          if (typeof event.tournamentId === 'string') {
            hub.unsubscribe(socket, event.tournamentId);
          }
          break;
        case 'ping':
          hub.send(socket, { type: 'pong', serverTime: new Date().toISOString() });
          break;
      }
    });

    socket.on('close', () => hub.remove(socket));
    socket.on('error', () => hub.remove(socket));
  });
}
