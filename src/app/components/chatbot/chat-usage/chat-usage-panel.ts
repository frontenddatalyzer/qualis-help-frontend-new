import { Component, ElementRef, HostListener, afterNextRender, computed, inject, input, model, output, signal } from '@angular/core';
import { ContextUsage, ConversationUsage, UsageLimit, UserUsage } from '../../../api/chat';
import {
  UsageTone,
  clampPercent,
  formatAdaptive,
  formatCompact,
  formatCost,
  formatNumber,
  formatPercent,
  formatResetsIn,
  usageTone
} from './usage-format';

interface Meter {
  percentText: string;
  width: number; // bar fill, capped at 100
  tone: UsageTone;
}

interface BreakdownRow {
  label: string;
  chat: string;
  month: string;
}

// The usage popover: context window, usage limits, and an expandable detailed breakdown.
// Rendered only while open; closes on Esc or a click outside.
@Component({
  selector: 'app-chat-usage-panel',
  templateUrl: './chat-usage-panel.html',
  styleUrl: './chat-usage-panel.scss'
})
export class ChatUsagePanel {
  context = input<ContextUsage | null>(null);
  conversation = input<ConversationUsage | null>(null);
  user = input<UserUsage | null>(null);
  limit = input<UsageLimit | null>(null);
  lastTurnTokens = input<number | null>(null);
  modelName = input<string | null>(null);

  breakdownOpen = model(false); // remembered by the parent for the page session
  closed = output<void>();

  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private now = signal(Date.now()); // fixed when the panel opens; "Resets in" is relative to it

  constructor() {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>('.panel')?.focus());
  }

  // --- Section A: context window ---

  contextValue = computed(() => {
    const c = this.context();
    return `${formatCompact(c?.used_tokens)} / ${formatCompact(c?.limit_tokens)} (${formatPercent(c?.percent)})`;
  });

  contextMeter = computed(() => this.meter(this.context()?.percent));

  turnsText = computed(() => {
    const c = this.context();
    return c?.max_turns ? `Turn ${formatNumber(c.turns)} of ${formatNumber(c.max_turns)}` : null;
  });

  // --- Section B: usage limits ---

  // Without a monthly limit there is nothing to measure against: totals only, no bars or percentages
  hasLimit = computed(() => this.limit()?.monthly_tokens != null);

  chatTokens = computed(() => formatAdaptive(this.conversation()?.total_tokens));
  chatMeter = computed(() => this.meter(this.conversation()?.percent_of_limit));

  monthTokens = computed(() => formatAdaptive(this.user()?.total_tokens));
  monthMeter = computed(() => this.meter(this.user()?.percent_of_limit));
  monthLimit = computed(() => formatAdaptive(this.limit()?.monthly_tokens));
  resetsIn = computed(() => formatResetsIn(this.limit()?.resets_at, this.now()));

  // --- Detailed breakdown ---

  breakdown = computed<BreakdownRow[]>(() => {
    const chat = this.conversation();
    const month = this.user();
    const rows: BreakdownRow[] = [
      { label: 'Input', chat: formatAdaptive(chat?.input_tokens), month: formatAdaptive(month?.input_tokens) },
      { label: 'Output', chat: formatAdaptive(chat?.output_tokens), month: formatAdaptive(month?.output_tokens) },
      { label: 'Total', chat: formatAdaptive(chat?.total_tokens), month: formatAdaptive(month?.total_tokens) },
      { label: 'Questions', chat: formatAdaptive(chat?.requests), month: formatAdaptive(month?.requests) },
      { label: 'From cache', chat: formatAdaptive(chat?.cached_requests), month: formatAdaptive(month?.cached_requests) }
    ];
    const chatCost = formatCost(chat?.cost);
    const monthCost = formatCost(month?.cost);
    if (chatCost || monthCost) {
      rows.push({ label: 'Cost', chat: chatCost ?? '–', month: monthCost ?? '–' });
    }
    return rows;
  });

  lastAnswer = computed(() => {
    const tokens = this.lastTurnTokens();
    return tokens === null ? null : `Last answer: ${formatAdaptive(tokens)} tokens`;
  });

  toggleBreakdown() {
    this.breakdownOpen.update(open => !open);
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    this.closed.emit();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event) {
    const target = event.target as HTMLElement | null;
    // The trigger toggles the panel itself; everything else outside the panel closes it
    if (target && !this.host.nativeElement.contains(target) && !target.closest?.('.usage-trigger')) {
      this.closed.emit();
    }
  }

  private meter(percent: number | null | undefined): Meter {
    return { percentText: formatPercent(percent), width: clampPercent(percent), tone: usageTone(percent) };
  }
}
