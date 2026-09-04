import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import {
  classicSixPairBracket,
  classicTwelvePairBracket,
  type BracketGameSettings,
  groupSourceTokens,
  outcomeSourceTokens,
  placesPerGroup,
  slotHeading,
  validateBracketConfig,
  type BracketConfig,
  type BracketIssueId,
  type BracketStage,
  type BracketStageKind,
} from '@fsp/shared';
import { I18nService } from '../../core/i18n';

let stageSeq = 0;

@Component({
  selector: 'app-bracket-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack stack--4">
      <div class="stack stack--2">
        <div class="row row--between row--wrap">
          <span class="field__label">{{ t()('bracket.title') }}</span>
          <div class="row row--wrap">
            <button type="button" class="btn btn--sm btn--glass" (click)="applyPreset('twelve')">
              {{ t()('bracket.preset12') }}
            </button>
            <button type="button" class="btn btn--sm btn--glass" (click)="applyPreset('six')">
              {{ t()('bracket.preset6') }}
            </button>
          </div>
        </div>
        <p class="tiny muted">{{ t()('bracket.intro') }}</p>
      </div>

      <div class="stack stack--3">
        <span class="field__label">{{ t()('bracket.groupSection') }}</span>

        <div class="row row--wrap row--fields">
          <label class="field grow">
            <span class="field__label">{{ t()('bracket.groups') }}</span>
            <input
              class="input numeric"
              type="number"
              min="1"
              max="8"
              [value]="config().groupCount"
              (input)="patch({ groupCount: num($event, 1) })"
            />
          </label>
          <label class="field grow">
            <span class="field__label">{{ t()('bracket.groupMatches') }}</span>
            <input
              class="input numeric"
              type="number"
              min="1"
              max="3"
              [value]="config().groupMatchesPerPairing"
              (input)="patch({ groupMatchesPerPairing: num($event, 1) })"
            />
          </label>
        </div>

        <div class="row row--wrap row--fields">
          <label class="field grow">
            <span class="field__label">{{ t()('bracket.groupWinsToTake') }}</span>
            <input
              class="input numeric"
              type="number"
              min="1"
              max="3"
              [value]="config().groupGames.winsToTake"
              (input)="patchGroupGames({ winsToTake: num($event, 1) })"
            />
            <span class="field__hint">{{ t()('bracket.groupWinsHint') }}</span>
          </label>
          <label class="field grow">
            <span class="field__label">{{ t()('bracket.groupPointsToWin') }}</span>
            <input
              class="input numeric"
              type="number"
              min="1"
              max="99"
              [value]="config().groupGames.pointsToWin"
              (input)="patchGroupGames({ pointsToWin: num($event, 11) })"
            />
            <span class="field__hint">{{ t()('bracket.groupPointsHint') }}</span>
          </label>
        </div>

        <div class="row row--between">
          <div class="stack stack--1 grow">
            <span class="field__label">{{ t()('bracket.winByTwo') }}</span>
            <span class="field__hint">{{ t()('bracket.winByTwoHint') }}</span>
          </div>
          <label class="switch">
            <input
              type="checkbox"
              [checked]="config().groupGames.winByTwo"
              (change)="patchGroupGames({ winByTwo: checked($event) })"
            />
            <span class="switch__track"></span>
            <span class="switch__thumb"></span>
          </label>
        </div>
      </div>

      <div class="stack stack--3">
        <div class="stack stack--1">
          <span class="field__label">{{ t()('bracket.playoffSection') }}</span>
          <p class="tiny muted">{{ t()('bracket.playoffHint') }}</p>
        </div>

        @for (stage of config().stages; track stage.id; let stageIndex = $index) {
          <section class="glass glass--subtle card--tight stack stack--3">
            <div class="row row--wrap row--fields">
              <label class="field grow">
                <span class="field__label">{{ t()('bracket.stageName') }}</span>
                <input
                  class="input"
                  [value]="stage.name"
                  (input)="patchStage(stageIndex, { name: text($event) })"
                />
              </label>
              <label class="field grow">
                <span class="field__label">{{ t()('bracket.kind') }}</span>
                <select
                  class="select"
                  [value]="stage.kind"
                  (change)="patchStage(stageIndex, { kind: kind($event) })"
                >
                  <option value="playoff">{{ t()('bracket.stagePlayoff') }}</option>
                  <option value="consolation">{{ t()('bracket.stageConsolation') }}</option>
                </select>
              </label>
            </div>
            <div class="row row--wrap row--fields">
              <label class="field grow">
                <span class="field__label">{{ t()('bracket.winsToTake') }}</span>
                <input
                  class="input numeric"
                  type="number"
                  min="1"
                  max="3"
                  [value]="stage.games.winsToTake"
                  (input)="patchStageGames(stageIndex, { winsToTake: num($event, 2) })"
                />
                <span class="field__hint">{{ t()('bracket.stageWinsHint') }}</span>
              </label>
              <label class="field grow">
                <span class="field__label">{{ t()('bracket.stagePointsToWin') }}</span>
                <input
                  class="input numeric"
                  type="number"
                  min="1"
                  max="99"
                  [value]="stage.games.pointsToWin"
                  (input)="patchStageGames(stageIndex, { pointsToWin: num($event, 11) })"
                />
                <span class="field__hint">{{ t()('bracket.stagePointsHint') }}</span>
              </label>
            </div>

            <div class="row row--between">
              <div class="stack stack--1 grow">
                <span class="field__label">{{ t()('bracket.winByTwo') }}</span>
                <span class="field__hint">{{ t()('bracket.winByTwoHint') }}</span>
              </div>
              <label class="switch">
                <input
                  type="checkbox"
                  [checked]="stage.games.winByTwo"
                  (change)="patchStageGames(stageIndex, { winByTwo: checked($event) })"
                />
                <span class="switch__track"></span>
                <span class="switch__thumb"></span>
              </label>
            </div>

            @for (slot of stage.slots; track slot.id; let slotIndex = $index) {
              <div class="match" [class.match--split]="slotIndex > 0">
                <div class="row row--between">
                  <span class="tiny faint">{{ matchHeading(stage, slotIndex) }}</span>
                  @if (stage.slots.length > 1) {
                    <button
                      type="button"
                      class="btn btn--sm btn--ghost"
                      (click)="removeSlot(stageIndex, slotIndex)"
                    >
                      {{ t()('bracket.removeMatch') }}
                    </button>
                  }
                </div>
                <div class="row row--wrap row--fields">
                  <label class="field grow">
                    <span class="field__label">{{ t()('bracket.sideA') }}</span>
                    <select
                      class="select"
                      (change)="patchSlot(stageIndex, slotIndex, { sourceA: text($event) })"
                    >
                      <option value="" [selected]="!slot.sourceA">{{ t()('bracket.pickSource') }}</option>
                      @for (group of sourceGroups(stageIndex, slot.sourceA); track group.label) {
                        <optgroup [label]="group.label">
                          @for (option of group.options; track option.value) {
                            <option [value]="option.value" [selected]="option.value === slot.sourceA">
                              {{ option.label }}
                            </option>
                          }
                        </optgroup>
                      }
                    </select>
                  </label>
                  <span class="vs tiny faint">{{ t()('bracket.vs') }}</span>
                  <label class="field grow">
                    <span class="field__label">{{ t()('bracket.sideB') }}</span>
                    <select
                      class="select"
                      (change)="patchSlot(stageIndex, slotIndex, { sourceB: text($event) })"
                    >
                      <option value="" [selected]="!slot.sourceB">{{ t()('bracket.pickSource') }}</option>
                      @for (group of sourceGroups(stageIndex, slot.sourceB); track group.label) {
                        <optgroup [label]="group.label">
                          @for (option of group.options; track option.value) {
                            <option [value]="option.value" [selected]="option.value === slot.sourceB">
                              {{ option.label }}
                            </option>
                          }
                        </optgroup>
                      }
                    </select>
                  </label>
                </div>
              </div>
            }

            <p class="tiny faint">{{ t()('bracket.addSlotHint') }}</p>
            <div class="row row--wrap">
              <button type="button" class="btn btn--sm btn--glass" (click)="addSlot(stageIndex)">
                {{ t()('bracket.addSlot') }}
              </button>
              <button
                type="button"
                class="btn btn--sm btn--ghost"
                (click)="removeStage(stageIndex)"
              >
                {{ t()('bracket.removeStage') }}
              </button>
            </div>
          </section>
        }

        <div class="stack stack--1">
          <button type="button" class="btn btn--sm btn--glass" (click)="addStage()">
            {{ t()('bracket.addStage') }}
          </button>
          <p class="tiny faint">{{ t()('bracket.addStageHint') }}</p>
        </div>

        @if (config().stages.length > 0) {
          <div class="stack stack--2">
            <span class="field__label">{{ t()('bracket.preview') }}</span>
            @for (stage of config().stages; track stage.id) {
              @for (slot of stage.slots; track slot.id; let slotIndex = $index) {
                <div class="preview">
                  {{
                    t()('bracket.previewLine', {
                      match: matchHeading(stage, slotIndex),
                      a: sourceLabel(slot.sourceA) || t()('bracket.pickSource'),
                      b: sourceLabel(slot.sourceB) || t()('bracket.pickSource'),
                      rules: rulesLabel(stage.games),
                    })
                  }}
                </div>
              }
            }
            @for (issue of issues(); track issue) {
              <p class="tiny issue">{{ issueText(issue) }}</p>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    .match {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }

    .match--split {
      padding-top: var(--space-3);
      border-top: 1px solid var(--divider);
    }

    .vs {
      align-self: end;
      padding-bottom: 12px;
    }

    .preview {
      font-size: 13.5px;
      line-height: 1.35;
    }

    .issue {
      color: var(--danger);
    }
  `,
})
export class BracketEditor {
  readonly config = input.required<BracketConfig>();
  readonly maxPlayers = input(12);
  readonly changed = output<BracketConfig>();
  readonly presetApplied = output<{ players: number; courts: number }>();

  private readonly i18n = inject(I18nService);
  protected readonly t = this.i18n.t;

  private readonly places = computed(() =>
    placesPerGroup(this.maxPlayers(), this.config().groupCount),
  );

  protected readonly issues = computed(() => validateBracketConfig(this.config()));

  protected applyPreset(kind: 'twelve' | 'six'): void {
    if (kind === 'twelve') {
      this.changed.emit(classicTwelvePairBracket());
      this.presetApplied.emit({ players: 24, courts: 6 });
      return;
    }
    this.changed.emit(classicSixPairBracket(this.config().groupGames.pointsToWin));
    this.presetApplied.emit({ players: 12, courts: 3 });
  }

  protected patch(partial: Partial<BracketConfig>): void {
    this.changed.emit({ ...this.config(), ...partial });
  }

  protected patchGroupGames(partial: Partial<BracketConfig['groupGames']>): void {
    this.patch({ groupGames: { ...this.config().groupGames, ...partial } });
  }

  protected patchStage(index: number, partial: Partial<BracketStage>): void {
    const stages = this.config().stages.map((stage, i) =>
      i === index ? { ...stage, ...partial } : stage,
    );
    this.patch({ stages });
  }

  protected patchStageGames(index: number, partial: Partial<BracketStage['games']>): void {
    const stage = this.config().stages[index];
    if (!stage) return;
    this.patchStage(index, { games: { ...stage.games, ...partial } });
  }

  protected patchSlot(
    stageIndex: number,
    slotIndex: number,
    partial: Partial<BracketStage['slots'][number]>,
  ): void {
    const stage = this.config().stages[stageIndex];
    if (!stage) return;
    const slots = stage.slots.map((slot, i) => (i === slotIndex ? { ...slot, ...partial } : slot));
    this.patchStage(stageIndex, { slots });
  }

  protected addStage(): void {
    stageSeq += 1;
    const id = `stage${stageSeq}`;
    this.patch({
      stages: [
        ...this.config().stages,
        {
          id,
          kind: 'playoff',
          name: this.i18n.translate('bracket.stagePlayoff'),
          games: { ...this.config().groupGames, winsToTake: 2, winByTwo: false },
          slots: [{ id: `${id}1`, sourceA: '', sourceB: '' }],
        },
      ],
    });
  }

  protected addSlot(stageIndex: number): void {
    const stage = this.config().stages[stageIndex];
    if (!stage) return;
    stageSeq += 1;
    this.patchStage(stageIndex, {
      slots: [...stage.slots, { id: `${stage.id}${stageSeq}`, sourceA: '', sourceB: '' }],
    });
  }

  protected removeSlot(stageIndex: number, slotIndex: number): void {
    const stage = this.config().stages[stageIndex];
    if (!stage || stage.slots.length <= 1) return;
    this.patchStage(stageIndex, {
      slots: stage.slots.filter((_, index) => index !== slotIndex),
    });
  }

  protected removeStage(stageIndex: number): void {
    this.patch({ stages: this.config().stages.filter((_, index) => index !== stageIndex) });
  }

  protected matchHeading(stage: BracketStage, slotIndex: number): string {
    const slot = stage.slots[slotIndex];
    if (slot) return slotHeading(this.config(), slot.id);
    if (stage.slots.length === 1) return stage.name;
    return this.i18n.translate('bracket.match', { name: stage.name, number: slotIndex + 1 });
  }

  protected rulesLabel(games: BracketGameSettings): string {
    return games.winsToTake <= 1
      ? this.i18n.translate('bracket.gameRulesOne', { points: games.pointsToWin })
      : this.i18n.translate('bracket.gameRulesSeries', {
          wins: games.winsToTake,
          points: games.pointsToWin,
        });
  }

  protected sourceGroups(
    stageIndex: number,
    current: string,
  ): { label: string; options: { value: string; label: string }[] }[] {
    const groupTokens = groupSourceTokens(this.config().groupCount, this.places());
    const outcomeTokens = outcomeSourceTokens(this.config().stages.slice(0, stageIndex));
    const known = new Set([...groupTokens, ...outcomeTokens]);
    const groups: { label: string; options: { value: string; label: string }[] }[] = [];
    if (groupTokens.length > 0) {
      groups.push({
        label: this.i18n.translate('bracket.groupPlaces'),
        options: groupTokens.map((value) => ({ value, label: this.sourceLabel(value) })),
      });
    }
    if (outcomeTokens.length > 0) {
      groups.push({
        label: this.i18n.translate('bracket.previousResults'),
        options: outcomeTokens.map((value) => ({ value, label: this.sourceLabel(value) })),
      });
    }
    if (current && !known.has(current)) {
      groups.push({
        label: current,
        options: [{ value: current, label: this.sourceLabel(current) }],
      });
    }
    return groups;
  }

  protected issueText(issue: BracketIssueId): string {
    switch (issue) {
      case 'emptySources':
        return this.i18n.translate('bracket.issue.emptySources');
      case 'duplicateSources':
        return this.i18n.translate('bracket.issue.duplicateSources');
      case 'noFinal':
        return this.i18n.translate('bracket.issue.noFinal');
      case 'noThirdPlace':
        return this.i18n.translate('bracket.issue.noThirdPlace');
    }
  }

  protected sourceLabel(token: string): string {
    const group = /^G(\d+)\.(\d+)$/.exec(token);
    if (group) {
      const key =
        this.config().groupCount <= 1 ? 'bracket.groupPlaceSingle' : 'bracket.groupPlace';
      return this.i18n.translate(key, { group: group[1]!, place: group[2]! });
    }
    const letter = /^([A-Z])(\d+)$/.exec(token);
    if (letter) {
      const groupIndex = letter[1]!.charCodeAt(0) - 64;
      const key =
        this.config().groupCount <= 1 ? 'bracket.groupPlaceSingle' : 'bracket.groupPlace';
      return this.i18n.translate(key, { group: String(groupIndex), place: letter[2]! });
    }
    const outcome = /^(.+)\.(W|L)$/.exec(token);
    if (outcome) {
      const match = this.matchTitle(outcome[1]!);
      return this.i18n.translate(outcome[2] === 'W' ? 'bracket.winnerOf' : 'bracket.loserOf', {
        match,
      });
    }
    return token;
  }

  protected matchTitle(slotId: string): string {
    return slotHeading(this.config(), slotId);
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected num(event: Event, fallback: number): number {
    const value = Number.parseInt(this.text(event), 10);
    return Number.isFinite(value) ? value : fallback;
  }

  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  protected kind(event: Event): Exclude<BracketStageKind, 'group'> {
    return this.text(event) === 'consolation' ? 'consolation' : 'playoff';
  }
}
