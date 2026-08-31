import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TournamentStore } from '../../core/tournament-store';
import { StandingsView } from './standings-view';

/**
 * Вкладка «Таблица» в карточке турнира.
 *
 * Данные из стора, отрисовка — общая с публичным табло.
 */
@Component({
  selector: 'app-tournament-standings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StandingsView],
  template: `
    <app-standings-view
      [isFixedPairs]="store.isFixedPairs()"
      [status]="tournament()?.status ?? null"
      [tieRule]="tournament()?.tieRule ?? 'draw'"
      [standingsSort]="tournament()?.standingsSort ?? ['wins', 'points', 'diff']"
      [standings]="store.standings()"
      [teamStandings]="store.teamStandings()"
      [rounds]="store.rounds()"
      [bracketConfig]="tournament()?.bracketConfig ?? null"
    />
  `,
})
export class TournamentStandingsTab {
  protected readonly store = inject(TournamentStore);
  protected readonly tournament = this.store.tournament;
}
