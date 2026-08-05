import {
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
  inject,
  type ApplicationConfig,
} from '@angular/core';
import {
  provideRouter,
  Router,
  withComponentInputBinding,
  withInMemoryScrolling,
  withViewTransitions,
} from '@angular/router';
import { routes } from './app.routes';
import { readTournamentDeepLink } from './core/deep-link';
import { RealtimeService } from './core/realtime';
import { SessionStore } from './core/session';
import { TelegramService } from './core/telegram';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Приложение полностью на сигналах, зона не нужна.
    provideZonelessChangeDetection(),
    provideRouter(
      routes,
      // Переходы между экранами анимируются браузером: мяч «перелетает» между страницами.
      withViewTransitions({ skipInitialTransition: true }),
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' }),
    ),
    provideAppInitializer(async () => {
      const telegram = inject(TelegramService);
      const session = inject(SessionStore);
      const realtime = inject(RealtimeService);
      const router = inject(Router);

      telegram.init();
      // Вход не блокирует показ приложения дольше необходимого: если Telegram
      // недоступен, остаёмся наблюдателем и сразу показываем турниры.
      await session.init();
      realtime.connect();

      const tournamentId = readTournamentDeepLink(telegram.startParam);
      if (tournamentId) {
        await router.navigate(['/tournaments', tournamentId], { replaceUrl: true });
      }
    }),
  ],
};
