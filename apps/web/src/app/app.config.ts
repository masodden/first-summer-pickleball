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
import { isTabSwipeActive } from './core/tab-view-transition';
import { TelegramService } from './core/telegram';
import { TelegramBackNavigation } from './core/telegram-back';
import {
  applyNavViewTransition,
  clearNavViewTransition,
  pathFromSnapshot,
  reducedMotion,
} from './core/motion';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Приложение полностью на сигналах, зона не нужна.
    provideZonelessChangeDetection(),
    provideRouter(
      routes,
      // View Transitions: табы — свой свайп; список→деталь — push/pop; вкладки турнира — короткий слайд.
      withViewTransitions({
        skipInitialTransition: true,
        onViewTransitionCreated: ({ transition, from, to }) => {
          if (isTabSwipeActive() || reducedMotion() || !from || !to) {
            transition.skipTransition();
            return;
          }
          applyNavViewTransition(pathFromSnapshot(from), pathFromSnapshot(to));
          void transition.finished.finally(() => clearNavViewTransition());
        },
      }),
      withComponentInputBinding(),
      // Скролл живёт в `#main`, не в window: иначе desktop Telegram запоминает
      // высоту предыдущего таба и оставляет пустое место / обрезает низ.
      withInMemoryScrolling({ scrollPositionRestoration: 'disabled', anchorScrolling: 'disabled' }),
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
