import { inject } from '@angular/core';
import { Router, type CanMatchFn, type Routes } from '@angular/router';
import { SessionStore } from './core/session';
import { ViewStateService } from './core/view-state';

/** Турниры: модератор и админ. */
const canManageTournaments: CanMatchFn = () => {
  const session = inject(SessionStore);
  if (session.isModerator()) return true;
  return inject(Router).parseUrl('/tournaments');
};

/** Тренировки: организатор, модератор и админ. */
const canManageTrainings: CanMatchFn = () => {
  const session = inject(SessionStore);
  if (session.canManageTrainings()) return true;
  return inject(Router).parseUrl('/trainings');
};

const isAdmin: CanMatchFn = () => {
  const session = inject(SessionStore);
  if (session.isAdmin()) return true;
  return inject(Router).parseUrl('/tournaments');
};

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'tournaments' },
  {
    path: 'tournaments',
    loadComponent: () =>
      import('./features/tournaments/tournament-list').then((m) => m.TournamentListPage),
    title: 'Турниры',
  },
  {
    path: 'tournaments/new',
    canMatch: [canManageTournaments],
    loadComponent: () =>
      import('./features/tournaments/tournament-form').then((m) => m.TournamentFormPage),
    title: 'Новый турнир',
  },
  {
    path: 'tournaments/:id/edit',
    canMatch: [canManageTournaments],
    loadComponent: () =>
      import('./features/tournaments/tournament-form').then((m) => m.TournamentFormPage),
    title: 'Редактирование турнира',
  },
  {
    path: 'tournaments/:id',
    loadComponent: () =>
      import('./features/tournaments/tournament-detail').then((m) => m.TournamentDetailPage),
    children: [
      // Открываем ту вкладку, с которой ушли: на площадке возвращаются к своему делу.
      { path: '', pathMatch: 'full', redirectTo: () => inject(ViewStateService).lastTab() },
      {
        path: 'info',
        loadComponent: () =>
          import('./features/tournaments/tournament-info').then((m) => m.TournamentInfoTab),
      },
      {
        path: 'players',
        loadComponent: () =>
          import('./features/tournaments/tournament-players').then((m) => m.TournamentPlayersTab),
      },
      {
        path: 'rounds',
        loadComponent: () =>
          import('./features/tournaments/tournament-rounds').then((m) => m.TournamentRoundsTab),
      },
      {
        path: 'standings',
        loadComponent: () =>
          import('./features/tournaments/tournament-standings').then(
            (m) => m.TournamentStandingsTab,
          ),
      },
    ],
  },
  {
    path: 'trainings',
    loadComponent: () =>
      import('./features/trainings/training-list').then((m) => m.TrainingListPage),
    title: 'Тренировки',
  },
  {
    path: 'trainings/new',
    canMatch: [canManageTrainings],
    loadComponent: () =>
      import('./features/trainings/training-form').then((m) => m.TrainingFormPage),
    title: 'Новая тренировка',
  },
  {
    path: 'trainings/:id/edit',
    canMatch: [canManageTrainings],
    loadComponent: () =>
      import('./features/trainings/training-form').then((m) => m.TrainingFormPage),
    title: 'Редактирование тренировки',
  },
  {
    path: 'trainings/:id',
    loadComponent: () =>
      import('./features/trainings/training-detail').then((m) => m.TrainingDetailPage),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'info' },
      {
        path: 'info',
        loadComponent: () =>
          import('./features/trainings/training-info').then((m) => m.TrainingInfoTab),
      },
      {
        path: 'players',
        loadComponent: () =>
          import('./features/trainings/training-players').then((m) => m.TrainingPlayersTab),
      },
    ],
  },
  {
    path: 'about',
    loadComponent: () => import('./features/about/about-page').then((m) => m.AboutPage),
    title: 'Об игре',
  },
  {
    path: 'players',
    loadComponent: () =>
      import('./features/players/player-directory').then((m) => m.PlayerDirectoryPage),
    title: 'Игроки',
  },
  {
    path: 'players/:id',
    loadComponent: () =>
      import('./features/players/player-profile').then((m) => m.PlayerProfilePage),
  },
  {
    path: 'settings',
    loadComponent: () => import('./features/settings/settings-page').then((m) => m.SettingsPage),
    title: 'Настройки',
  },
  {
    path: 'admin',
    canMatch: [isAdmin],
    loadComponent: () => import('./features/admin/admin-page').then((m) => m.AdminPage),
    title: 'Администрирование',
  },
  {
    path: 'claim',
    loadComponent: () => import('./features/auth/claim-page').then((m) => m.ClaimPage),
    title: 'Привязка DUPR',
  },
  {
    path: 'board/:slug',
    loadComponent: () => import('./features/public/public-board').then((m) => m.PublicBoardPage),
    title: 'Табло',
  },
  { path: '**', redirectTo: 'tournaments' },
];
