import type { Database } from '../db/index.js';
import type { Env } from '../env.js';
import type { RealtimeHub } from '../realtime/hub.js';
import type { NotificationSender } from '../bot/notifications.js';

export interface AppContext {
  db: Database;
  hub: RealtimeHub;
  env: Env;
  notify: NotificationSender;
}
