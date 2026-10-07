import { UsageCost } from '../../../api/chat';

const NUMBER = new Intl.NumberFormat('en-US');
const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
// Per-answer costs are tiny fractions of a cent, so keep up to 6 decimals
const COST = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type UsageTone = 'normal' | 'warning' | 'danger';

/** 12345 -> "12,345" */
export function formatNumber(value: number | null | undefined): string {
  return NUMBER.format(Math.round(value ?? 0));
}

/** 488200 -> "488.2k", 1000000 -> "1M", 950 -> "950" */
export function formatCompact(value: number | null | undefined): string {
  return COMPACT.format(Math.round(value ?? 0)).replace('K', 'k');
}

/** Full value with separators under 10,000 ("7,163"), compact above ("381.7k", "5.2M") */
export function formatAdaptive(value: number | null | undefined): string {
  const n = Math.round(value ?? 0);
  return Math.abs(n) < 10_000 ? NUMBER.format(n) : formatCompact(n);
}

/** "12,345 tokens" (singular for exactly one) */
export function formatTokens(value: number | null | undefined): string {
  const n = Math.round(value ?? 0);
  return `${NUMBER.format(n)} ${n === 1 ? 'token' : 'tokens'}`;
}

/**
 * The optional `cost` field, or null when absent. A number is shown as US dollars (the backend
 * sends no currency); a string is shown exactly as sent.
 */
export function formatCost(cost: UsageCost | undefined): string | null {
  if (cost === null || cost === undefined || cost === '') {
    return null;
  }
  return typeof cost === 'number' ? `$${COST.format(cost)}` : String(cost);
}

/** "8%"; anything between 0 and 1 shows as "<1%" rather than a misleading "0%" */
export function formatPercent(percent: number | null | undefined): string {
  const p = percent ?? 0;
  return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`;
}

/** Bar width: the fill never exceeds the track */
export function clampPercent(percent: number | null | undefined): number {
  return Math.min(100, Math.max(0, percent ?? 0));
}

/** Warning colour from 80%, danger from 100% */
export function usageTone(percent: number | null | undefined): UsageTone {
  const p = percent ?? 0;
  return p >= 100 ? 'danger' : p >= 80 ? 'warning' : 'normal';
}

/** Time until `resetsAt`: "12 d 4 hr" when more than a day away, otherwise "3 hr 43 min" */
export function formatResetsIn(resetsAt: string | null | undefined, now: number): string | null {
  const target = resetsAt ? Date.parse(resetsAt) : NaN;
  if (isNaN(target)) {
    return null;
  }
  const remaining = Math.max(0, target - now);
  if (remaining > DAY_MS) {
    return `${Math.floor(remaining / DAY_MS)} d ${Math.floor((remaining % DAY_MS) / HOUR_MS)} hr`;
  }
  return `${Math.floor(remaining / HOUR_MS)} hr ${Math.floor((remaining % HOUR_MS) / 60_000)} min`;
}
