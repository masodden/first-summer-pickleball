import type { ServerEvent } from '@fsp/shared';

export interface RealtimeSocket {
  send(payload: string): void;
  readyState: number;
}

const OPEN = 1;

/**
 * Комнаты по турнирам.
 *
 * Организаторы двух параллельных турниров работают одновременно, поэтому
 * рассылка идёт только подписчикам конкретного турнира: чужие обновления не
 * должны дёргать чужой экран.
 */
export class RealtimeHub {
  private readonly rooms = new Map<string, Set<RealtimeSocket>>();
  private readonly subscriptions = new Map<RealtimeSocket, Set<string>>();

  subscribe(socket: RealtimeSocket, tournamentId: string): void {
    const room = this.rooms.get(tournamentId) ?? new Set<RealtimeSocket>();
    room.add(socket);
    this.rooms.set(tournamentId, room);

    const own = this.subscriptions.get(socket) ?? new Set<string>();
    own.add(tournamentId);
    this.subscriptions.set(socket, own);
  }

  unsubscribe(socket: RealtimeSocket, tournamentId: string): void {
    this.rooms.get(tournamentId)?.delete(socket);
    this.subscriptions.get(socket)?.delete(tournamentId);
  }

  remove(socket: RealtimeSocket): void {
    const own = this.subscriptions.get(socket);
    if (own) {
      for (const tournamentId of own) {
        this.rooms.get(tournamentId)?.delete(socket);
      }
    }
    this.subscriptions.delete(socket);
  }

  broadcast(tournamentId: string, event: ServerEvent): void {
    const room = this.rooms.get(tournamentId);
    if (!room || room.size === 0) return;

    const payload = JSON.stringify(event);
    for (const socket of room) {
      if (socket.readyState !== OPEN) {
        room.delete(socket);
        continue;
      }
      try {
        socket.send(payload);
      } catch {
        room.delete(socket);
      }
    }
  }

  send(socket: RealtimeSocket, event: ServerEvent): void {
    if (socket.readyState !== OPEN) return;
    try {
      socket.send(JSON.stringify(event));
    } catch {
      this.remove(socket);
    }
  }

  roomSize(tournamentId: string): number {
    return this.rooms.get(tournamentId)?.size ?? 0;
  }
}
