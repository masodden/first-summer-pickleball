import {
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
  inject,
  type ApplicationConfig,
} from '@angular/core';
import {
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  withViewTransitions,
} from '@angular/router';
import { routes } from './app.routes';
import { RealtimeService } from './core/realtime';
import { SessionStore } from './core/session';
import { TelegramService } from './core/telegram';
import { TelegramBackNavigation } from './core/telegram-back';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Приложение полностью на сигналах, зона не нужна.
    provideZonelessChangeDetection(),
    provideRouter(
      routes,
      // View Transitions: chrome (хедер/таббар) зафиксирован в CSS, кроссфейд только у main.
      withViewTransitions({ skipInitialTransition: true }),
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' }),
    ),
    provideAppInitializer(async () => {
      const telegram = inject(TelegramService);
      const session = inject(SessionStore);
      const realtime = inject(RealtimeService);
      const backNav = inject(TelegramBackNavigation);

      telegram.init();
      // Вход не блокирует показ приложения дольше необходимого: если Telegram
      // недоступен, остаёмся наблюдателем и сразу показываем турниры.
      await session.init();
      realtime.connect();
      backNav.start();
      // Deep-link на турнир обрабатывается в App после первого NavigationEnd —
      // иначе редирект '' → /tournaments перетирает переход на /tournaments/:id.
    }),
  ],
};
