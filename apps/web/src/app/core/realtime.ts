import { Injectable, signal } from '@angular/core';
import { WS_HEARTBEAT_MS, WS_PATH, type ClientEvent, type ServerEvent } from '@fsp/shared';

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting';

type Listener = (event: ServerEvent) => void;

/**
 * WebSocket для живых обновлений.
 *
 * Организатор ставит галочку на одном телефоне — второй телефон и табло на
 * экране видят это сразу. Соединение одно, комнаты — по турнирам, поэтому два
 * параллельных турнира не мешают друг другу.
 *
 * При обрыве подписки восстанавливаются автоматически: во время турнира никто
 * не должен думать про переподключение.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private socket: WebSocket | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly rooms = new Set<string>();
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;

  private readonly stateSignal = signal<ConnectionState>('idle');
  readonly state = this.stateSignal.asReadonly();

  connect(): void {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;

    this.stateSignal.set(this.reconnectAttempt === 0 ? 'connecting' : 'reconnecting');
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${location.host}${WS_PATH}`);
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.reconnectAttempt = 0;
      this.stateSignal.set('open');
      // Возвращаем подписки: экран мог остаться открытым во время обрыва.
      for (const tournamentId of this.rooms) {
        this.send({ type: 'subscribe', tournamentId });
      }
      this.startHeartbeat();
    });

    socket.addEventListener('message', (event: MessageEvent<string>) => {
      let parsed: ServerEvent;
      try {
        parsed = JSON.parse(event.data) as ServerEvent;
      } catch {
        return;
      }
      for (const listener of this.listeners) listener(parsed);
    });

    socket.addEventListener('close', () => {
      this.stopHeartbeat();
      this.socket = null;
      this.scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      socket.close();
    });
  }

  subscribe(tournamentId: string): void {
    this.rooms.add(tournamentId);
    this.connect();
    this.send({ type: 'subscribe', tournamentId });
  }

  unsubscribe(tournamentId: string): void {
    this.rooms.delete(tournamentId);
    this.send({ type: 'unsubscribe', tournamentId });
  }

  /** Возвращает функцию отписки: её удобно вызвать в `DestroyRef`. */
  listen(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private send(event: ClientEvent): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(event));
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    this.stateSignal.set('reconnecting');
    this.reconnectAttempt += 1;
    // Постепенно увеличиваем паузу, но не дольше десяти секунд.
    const delay = Math.min(1000 * 2 ** Math.min(this.reconnectAttempt - 1, 3), 10_000);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      this.send({ type: 'ping' });
    }, WS_HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
