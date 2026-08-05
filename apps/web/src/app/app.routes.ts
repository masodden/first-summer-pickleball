import { inject } from '@angular/core';
import { Router, type CanMatchFn, type Routes } from '@angular/router';
import { SessionStore } from './core/session';

/** Организаторские экраны: без прав уводим на список турниров. */
const canManage: CanMatchFn = () => {
  const session = inject(SessionStore);
  if (session.isModerator()) return true;
  return inject(Router).parseUrl('/tournaments');
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
    canMatch: [canManage],
    loadComponent: () =>
      import('./features/tournaments/tournament-form').then((m) => m.TournamentFormPage),
    title: 'Новый турнир',
  },
  {
    path: 'tournaments/:id/edit',
    canMatch: [canManage],
    loadComponent: () =>
      import('./features/tournaments/tournament-form').then((m) => m.TournamentFormPage),
    title: 'Редактирование турнира',
  },
  {
    path: 'tournaments/:id',
    loadComponent: () =>
      import('./features/tournaments/tournament-detail').then((m) => m.TournamentDetailPage),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'info' },
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
