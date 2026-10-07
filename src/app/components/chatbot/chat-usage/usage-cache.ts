import { ContextUsage } from '../../../api/chat';

// The backend only reports how full a conversation's context is in the answer itself (`done.usage`);
// GET /api/usage returns just the limit. So the last known numbers per conversation are remembered
// here and shown again when that chat is reopened, until its next answer replaces them.

export interface CachedUsage {
  context: ContextUsage;
  lastTurnTokens: number | null;
}

const STORAGE_KEY = 'qualis_help_usage_cache';
const MAX_ENTRIES = 60; // most recently used conversations

type Entries = Record<string, CachedUsage & { at: number }>;

function read(): Entries {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {}; // storage unavailable or corrupt
  }
}

function write(entries: Entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // storage unavailable: the numbers are then only known until the chat is left
  }
}

export function getCachedUsage(conversationId: string | null): CachedUsage | null {
  const entry = conversationId ? read()[conversationId] : null;
  return entry?.context ? { context: entry.context, lastTurnTokens: entry.lastTurnTokens ?? null } : null;
}

export function setCachedUsage(conversationId: string, usage: CachedUsage) {
  const entries = read();
  entries[conversationId] = { ...usage, at: Date.now() };
  const ids = Object.keys(entries);
  if (ids.length > MAX_ENTRIES) {
    ids.sort((a, b) => entries[a].at - entries[b].at)
      .slice(0, ids.length - MAX_ENTRIES)
      .forEach(id => delete entries[id]);
  }
  write(entries);
}

export function removeCachedUsage(conversationId: string) {
  const entries = read();
  if (conversationId in entries) {
    delete entries[conversationId];
    write(entries);
  }
}
