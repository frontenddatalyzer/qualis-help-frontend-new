import { Component, computed, input, output } from '@angular/core';
import { clampPercent, formatPercent, usageTone } from './usage-format';

const RADIUS = 6;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// Small header button: a ring filled to the context percentage plus the number ("8%").
// Clicking it toggles the usage panel.
@Component({
  selector: 'app-chat-usage-trigger',
  template: `
    <button type="button" class="usage-trigger" [class]="tone()" (click)="toggle.emit()"
      [attr.aria-label]="'Token usage: context ' + label() + ' full'" aria-haspopup="dialog" [attr.aria-expanded]="expanded()"
      title="Token usage">
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <circle class="track" cx="8" cy="8" [attr.r]="radius" />
        <circle class="progress" cx="8" cy="8" [attr.r]="radius" [attr.stroke-dasharray]="circumference"
          [attr.stroke-dashoffset]="offset()" />
      </svg>
      <span>{{ label() }}</span>
    </button>
  `,
  styleUrl: './chat-usage-trigger.scss'
})
export class ChatUsageTrigger {
  percent = input(0);
  expanded = input(false);
  toggle = output<void>();

  readonly radius = RADIUS;
  readonly circumference = CIRCUMFERENCE;

  label = computed(() => formatPercent(this.percent()));
  tone = computed(() => usageTone(this.percent()));
  offset = computed(() => CIRCUMFERENCE * (1 - clampPercent(this.percent()) / 100));
}
