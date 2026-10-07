import { Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import {
  AnswerImage,
  ChatApiError,
  ChatResponse,
  ChatStatus,
  ChatTimings,
  ChatUsage,
  ContextUsage,
  ConversationUsage,
  Segment,
  Source,
  StreamStage,
  UsageCost,
  UsageLimit,
  UserUsage,
  continueChat,
  getConversation,
  getUsage,
  sendMessage,
  streamChat
} from '../../api/chat';
import { isSafeUrl } from './render-answer';
import { ChatImageItem, OpenImageEvent, toImageItem } from './chat-images';
import { buildAnswerBlocks } from './answer-blocks';
import { ChatThumbnails } from './chat-thumbnails/chat-thumbnails';
import { ChatLightbox } from './chat-lightbox/chat-lightbox';
import { ChatScreenshot } from './chat-screenshot/chat-screenshot';
import { ChatThinking } from './chat-thinking/chat-thinking';
import { ChatFeedback } from './chat-feedback/chat-feedback';
import { ChatUsageTrigger } from './chat-usage/chat-usage-trigger';
import { ChatUsagePanel } from './chat-usage/chat-usage-panel';
import { getCachedUsage, removeCachedUsage, setCachedUsage } from './chat-usage/usage-cache';
import { formatCost, formatTokens } from './chat-usage/usage-format';
import { ChatSidebar } from './chat-sidebar/chat-sidebar';
import { ChatHistoryStore } from './chat-sidebar/chat-history.store';

type DisplayBlock =
  // `raw` is the html string behind `html`, kept to reuse unchanged blocks while streaming
  | { kind: 'markdown'; html: SafeHtml; raw: string }
  | { kind: 'image'; item: ChatImageItem };

interface ChatMessage {
  id: number;
  // For feedback; turnId is null when the backend didn't send one (older builds)
  conversationId: string;
  turnId: string | null;
  question: string;
  standaloneQuestion: string | null;
  answer: string; // plain markdown, used for copying
  segments: Segment[];
  status: ChatStatus;
  citations: Source[];
  sources: Source[];
  model: string | null;
  latencyMs: number | null;
  timings: ChatTimings | null;
  // Usage of this answer; a continuation adds to it. tokens is null when the backend sent no usage
  tokens: number | null;
  cost: UsageCost;
  cached: boolean;
  images: AnswerImage[];
  blocks: DisplayBlock[]; // text and inline screenshots in reading order
  inlineImages: ChatImageItem[]; // the inline screenshots, in order (lightbox walks these)
  extraImages: ChatImageItem[]; // placed=false: shown under "More screenshots"
}

// The answer being streamed; replaced by a normal ChatMessage when `done` arrives
interface StreamView {
  question: string;
  stage: StreamStage | null;
  standaloneQuestion: string | null;
  blocks: DisplayBlock[];
  inlineImages: ChatImageItem[];
  interrupted: boolean; // the stream failed: keep what was shown, frozen, above the error
  // Set while continuing a cut-off answer: the stream renders inside that message's bubble
  continuesMsgId: number | null;
  fresh: boolean; // continuation only: no new word shown yet
}

interface ContinueNote {
  text: string;
  blocked: boolean; // the answer can't be continued (409/404): hide the button
}

const CANNOT_CONTINUE = "This answer can't be continued. Please ask the question again.";

interface ChatError {
  message: string;
  question: string;
}

// Earlier versions stored the open conversation's id under this key; it is only cleaned up now
const LEGACY_CONVERSATION_KEY = 'qualis-help-chat-conversation-id';
const MAX_QUESTION_LENGTH = 2000;
const STREAM_ID = -1; // message id used for hover highlighting inside the streaming answer
// Horizontal resize of the popup (dragging its left edge); not persisted, resets on reload
const POPUP_DEFAULT_WIDTH = 500;
const POPUP_MIN_WIDTH = 360;
const POPUP_MAX_WIDTH = 750;
const POPUP_VIEWPORT_MARGIN = 40; // never wider than the window minus this
const POPUP_KEYBOARD_STEP = 20;
const SIDEBAR_DOCK_WIDTH = 640; // keep in sync with the "chat" container queries in the stylesheets
const FOLLOW_SCROLL_THRESHOLD_PX = 80;
// Typewriter: each frame reveals max(1, backlog / 20) words
const REVEAL_BACKLOG_DIVISOR = 20;
// A complete word: it must be followed by whitespace, or it may still be growing
const NEXT_WORD_RE = /^\s*\S+(?=\s)/;
// If a scheduled animation frame hasn't fired after this long, frames are being withheld
// (covered window, background webview): show the text without the typewriter
const REVEAL_FRAME_TIMEOUT_MS = 300;

const STAGE_LABELS: Record<StreamStage, string> = {
  searching: 'Searching the documentation…',
  generating: 'Writing the answer…',
  thinking: 'Thinking…',
  citing: 'Adding citations…'
};
// Stages can follow each other within milliseconds (the model starts reasoning right after
// "generating"), so each one stays on screen at least this long to be readable
const STAGE_MIN_VISIBLE_MS = 900;

// A "not covered" answer that still cites related documentation
const NOT_IN_DOCS_RELATED_HINT = 'Not covered directly in the documentation — showing the closest related information.';

const STATUS_HINTS: Partial<Record<ChatStatus, string>> = {
  not_in_docs: "The documentation doesn't cover this.",
  no_relevant_docs: 'No relevant documentation found — try rephrasing or naming the product version.',
  ungrounded: "This answer isn't backed by citations — verify it.",
  truncated: 'The answer was cut off.'
};

@Component({
  selector: 'app-chatbot',
  imports: [FormsModule, NgTemplateOutlet, ChatThumbnails, ChatLightbox, ChatScreenshot, ChatThinking, ChatFeedback, ChatUsageTrigger, ChatUsagePanel, ChatSidebar],
  templateUrl: './chatbot.html',
  styleUrl: './chatbot.scss'
})
export class Chatbot {
  private sanitizer = inject(DomSanitizer);
  private injector = inject(Injector);
  private body = viewChild<ElementRef<HTMLElement>>('chatBody');
  private input = viewChild<ElementRef<HTMLInputElement>>('chatInput');
  private launcher = viewChild<ElementRef<HTMLButtonElement>>('launcher');

  readonly maxLength = MAX_QUESTION_LENGTH;
  readonly isSafeUrl = isSafeUrl;
  readonly streamId = STREAM_ID;

  isOpen = signal(false);
  message = '';

  readonly popupMinWidth = POPUP_MIN_WIDTH;
  readonly popupMaxWidth = POPUP_MAX_WIDTH;
  popupWidth = signal<number | null>(null); // null = default width from the stylesheet
  resizing = signal(false);
  private resizeStart: { x: number; width: number } | null = null;

  messages = signal<ChatMessage[]>([]);
  streamView = signal<StreamView | null>(null);
  loading = signal(false);
  restoring = signal(false);
  error = signal<ChatError | null>(null);
  copiedId = signal<number | null>(null);
  // Message shown under a cut-off answer after a failed "Continue", by message id
  continueNotes = signal<Record<number, ContinueNote>>({});

  stageLabel = computed(() => {
    const stage = this.streamView()?.stage;
    return (stage && STAGE_LABELS[stage]) || 'Thinking…';
  });

  // Token usage shown in the header; refreshed after every answer
  contextUsage = signal<ContextUsage | null>(null);
  conversationUsage = signal<ConversationUsage | null>(null);
  userUsage = signal<UserUsage | null>(null);
  limitUsage = signal<UsageLimit | null>(null);
  lastTurnTokens = signal<number | null>(null); // the last answer in this view
  usageModel = signal<string | null>(null);
  hasUsage = computed(() => !!(this.contextUsage() || this.conversationUsage() || this.userUsage() || this.limitUsage()));
  usagePanelOpen = signal(false);
  usageBreakdownOpen = signal(false); // remembered while the page stays open
  private usageVersion = 0; // bumped on every update so a slow GET /api/usage can't overwrite newer data

  // Screenshots
  lightboxItems = signal<ChatImageItem[] | null>(null);
  lightboxIndex = signal(0);
  hoveredCite = signal<{ msgId: number; index: number } | null>(null);
  private brokenImages = signal<ReadonlySet<string>>(new Set());
  private lightboxTrigger: HTMLElement | null = null;

  hasConversation = computed(
    () => this.messages().length > 0 || this.streamView() !== null || this.error() !== null || this.restoring()
        || this.activeConversationId() !== null
  );

  // The open conversation; null = a new chat that starts with the next question. Kept in memory
  // only: a page load always starts on a new chat, with past chats listed in the sidebar
  activeConversationId = signal<string | null>(null);
  private nextId = 1;

  // Chat history sidebar
  private history = inject(ChatHistoryStore);
  sidebarOpen = signal(false); // drawer state on narrow panels
  sidebarCollapsed = signal(false); // docked sidebar hidden by the user (wide panels)
  private popupEl = viewChild<ElementRef<HTMLElement>>('popup');
  chatNotice = signal<string | null>(null); // e.g. an expired chat
  chatTitle = computed(() => this.history.titleOf(this.activeConversationId()) ?? 'Help assistant');
  private openRequest = 0; // the latest "open chat" click wins

  // In-flight request (streaming or fallback)
  private activeRequest: AbortController | null = null;
  // Everything received so far: text buffers and images, in order ("received")
  private streamSegments: Segment[] = [];
  private streamSources: Source[] = [];
  private renderFrame: number | null = null;
  // Typewriter: segments before `seg` are fully shown, plus `chars` characters of segment `seg` ("shown")
  // Stage labels waiting for their turn on screen
  private stageQueue: StreamStage[] = [];
  private stageTimer: ReturnType<typeof setTimeout> | null = null;
  private stageShownAt = 0;
  private revealCursor = { seg: 0, chars: 0 };
  private revealStart = { seg: 0, chars: 0 }; // where a continuation began (everything before was already shown)
  private revealFrame: number | null = null;
  private revealWatchdog: ReturnType<typeof setTimeout> | null = null;
  private revealFlush = false; // `done` arrived: also reveal the last (possibly unterminated) word
  private revealWaiter: (() => void) | null = null;
  private reducedMotion = false;
  private visibilityListener = () => this.onVisibilityChange();

  constructor() {
    // Browser only (storage + DOMPurify); skipped during SSR
    afterNextRender(() => {
      this.removeLegacyStoredId();
      // Start on an empty new chat: list the past chats and show this browser's usage counters
      this.history.refresh();
      this.refreshUsage();
      document.addEventListener('visibilitychange', this.visibilityListener);
    });
    inject(DestroyRef).onDestroy(() => {
      this.activeRequest?.abort();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', this.visibilityListener);
      }
    });
  }

  openChat() {
    this.isOpen.set(true);
    this.scrollToBottom();
    this.focusInput();
  }

  closeChat() {
    this.isOpen.set(false);
    this.usagePanelOpen.set(false);
    // The launcher only exists while closed: focus it once it has rendered
    setTimeout(() => this.launcher()?.nativeElement.focus());
  }

  // --- Horizontal resize: drag (or arrow keys on) the handle on the popup's left edge ---

  onResizeStart(event: PointerEvent, popup: HTMLElement) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.resizeStart = { x: event.clientX, width: popup.offsetWidth };
    this.resizing.set(true);
  }

  onResizeMove(event: PointerEvent) {
    if (this.resizeStart) {
      // The popup is anchored on the right, so dragging left makes it wider
      this.setPopupWidth(this.resizeStart.width + (this.resizeStart.x - event.clientX));
    }
  }

  onResizeEnd(event: PointerEvent) {
    if (!this.resizeStart) {
      return;
    }
    this.resizeStart = null;
    this.resizing.set(false);
    const handle = event.currentTarget as HTMLElement;
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
  }

  onResizeKey(event: KeyboardEvent, popup: HTMLElement) {
    const width = popup.offsetWidth;
    const target: Record<string, number> = {
      ArrowLeft: width + POPUP_KEYBOARD_STEP,
      ArrowRight: width - POPUP_KEYBOARD_STEP,
      Home: POPUP_MIN_WIDTH,
      End: POPUP_MAX_WIDTH
    };
    if (event.key in target) {
      event.preventDefault();
      this.setPopupWidth(target[event.key]);
    }
  }

  resetPopupWidth() {
    this.popupWidth.set(null);
  }

  currentPopupWidth(): number {
    return this.popupWidth() ?? POPUP_DEFAULT_WIDTH;
  }

  private setPopupWidth(width: number) {
    const max = Math.min(POPUP_MAX_WIDTH, window.innerWidth - POPUP_VIEWPORT_MARGIN);
    const min = Math.min(POPUP_MIN_WIDTH, max);
    this.popupWidth.set(Math.round(Math.min(max, Math.max(min, width))));
  }

  async send() {
    const question = this.message.trim();
    // One request at a time: the conversation is ordered
    if (!question || this.loading() || question.length > MAX_QUESTION_LENGTH) {
      return;
    }

    this.error.set(null);
    this.chatNotice.set(null);
    this.setMessage('');
    this.loading.set(true);
    this.endStream();
    this.reducedMotion = this.prefersReducedMotion();
    this.streamView.set({
      question,
      stage: null,
      standaloneQuestion: null,
      blocks: [],
      inlineImages: [],
      interrupted: false,
      continuesMsgId: null,
      fresh: false
    });
    this.scrollToBottom();

    const controller = new AbortController();
    this.activeRequest = controller;
    let started = false;
    let streamedContent = false;

    try {
      let response: ChatResponse;
      try {
        response = await streamChat(
          question,
          this.activeConversationId(),
          {
            onStart: event => {
              started = true;
              this.setConversationId(event.conversation_id);
            },
            onStatus: event => this.queueStage(event.stage),
            onRetrieved: event => {
              this.streamSources = event.sources; // makes [n] markers clickable
              this.updateStream(view => ({ ...view, standaloneQuestion: event.standalone_question }));
              this.scheduleStreamRender();
            },
            // Deltas and images only extend what was received; the typewriter decides what is shown
            onDelta: event => {
              streamedContent = true;
              this.appendStreamText(event.text);
            },
            onImage: event => {
              streamedContent = true;
              // Closes the current text buffer; the image shows once the typewriter reaches it
              this.streamSegments.push({ type: 'image', ...event });
              this.scheduleReveal();
            }
          },
          controller.signal
        );
      } catch (err) {
        if (controller.signal.aborted || started) {
          throw err;
        }
        // The stream failed before it began (network, non-200, no ReadableStream): retry once without it
        response = await sendMessage(question, this.activeConversationId(), controller.signal);
      }
      if (streamedContent) {
        // Let the typewriter finish; the final render then shows the same text, so nothing jumps
        await this.finishReveal();
        if (controller.signal.aborted) {
          return;
        }
      }
      // `done` / the POST response is authoritative. The backend may also have started a new
      // conversation (unknown/expired id), so always keep the latest id
      this.setConversationId(response.conversation_id);
      this.messages.update(list => [...list, this.fromResponse(response)]);
      this.applyUsage(response);
      this.history.refresh(); // a new chat appears; the active one moves to the top
    } catch (err) {
      if (controller.signal.aborted) {
        return; // "New chat" cancelled it; state was already reset
      }
      if (streamedContent) {
        this.revealAll(true); // show everything received before the error
        this.renderStream();
      }
      this.error.set({ message: this.friendlyError(err), question });
      // Keep what the user typed so nothing is lost
      if (!this.message.trim()) {
        this.setMessage(question);
      }
    } finally {
      if (this.activeRequest === controller) {
        this.activeRequest = null;
        if (this.error() && streamedContent) {
          this.freezeStream(); // keep the partial answer visible above the error
        } else {
          this.endStream();
        }
        this.loading.set(false);
        if (this.error()) {
          this.scrollToBottom();
        } else if (!streamedContent) {
          this.scrollToLatestQuestion(); // cached / fallback answers appear all at once
        }
        this.focusInput();
      }
    }
  }

  // --- Continue a cut-off ("truncated") answer ---

  canContinue(msg: ChatMessage): boolean {
    const list = this.messages();
    return (
      msg.status === 'truncated' &&
      !!msg.turnId &&
      list[list.length - 1] === msg && // only the latest answer can be continued
      !this.loading() &&
      !this.streamView() &&
      !this.continueNotes()[msg.id]?.blocked
    );
  }

  /** The running continuation of this message, if any: its text is rendered in the message's bubble. */
  liveFor(msg: ChatMessage): StreamView | null {
    const view = this.streamView();
    return view?.continuesMsgId === msg.id ? view : null;
  }

  async continueAnswer(msg: ChatMessage) {
    if (!this.canContinue(msg) || !msg.turnId) {
      return;
    }
    this.error.set(null);
    this.setContinueNote(msg.id, null);
    this.loading.set(true);
    this.endStream();
    this.reducedMotion = this.prefersReducedMotion();

    // Start from the cut-off answer: it counts as already shown, so the typewriter only reveals
    // the new text, which is appended to the last text buffer
    this.streamSegments = msg.segments.map(segment => ({ ...segment }));
    this.streamSources = [...msg.sources, ...msg.citations];
    const last = this.streamSegments.at(-1);
    this.revealCursor =
      last?.type === 'markdown'
        ? { seg: this.streamSegments.length - 1, chars: last.text.length }
        : { seg: this.streamSegments.length, chars: 0 };
    this.revealStart = { ...this.revealCursor };
    this.streamView.set({
      question: msg.question,
      stage: null,
      standaloneQuestion: null,
      blocks: msg.blocks,
      inlineImages: msg.inlineImages,
      interrupted: false,
      continuesMsgId: msg.id,
      fresh: true
    });

    const controller = new AbortController();
    this.activeRequest = controller;
    let streamedContent = false;

    try {
      const response = await continueChat(
        msg.conversationId,
        msg.turnId,
        {
          onStart: event => this.setConversationId(event.conversation_id),
          onStatus: event => this.queueStage(event.stage),
          onDelta: event => {
            streamedContent = true;
            this.appendStreamText(event.text);
          },
          onImage: event => {
            streamedContent = true;
            this.streamSegments.push({ type: 'image', ...event });
            this.scheduleReveal();
          }
        },
        controller.signal
      );
      if (streamedContent) {
        await this.finishReveal();
        if (controller.signal.aborted) {
          return;
        }
      }
      // `done` is the complete answer for the same turn: replace the bubble's content with it.
      // Its usage.turn covers only the continuation, so add it to what this answer already used.
      this.setConversationId(response.conversation_id);
      const continued = this.fromResponse(response);
      const merged: ChatMessage = {
        ...continued,
        id: msg.id,
        tokens: continued.tokens === null ? msg.tokens : (msg.tokens ?? 0) + continued.tokens,
        cost: this.addCost(msg.cost, continued.cost),
        cached: false
      };
      this.messages.update(list => list.map(m => (m.id === msg.id ? merged : m)));
      this.applyUsage(response);
      this.history.refresh(); // a new chat appears; the active one moves to the top
    } catch (err) {
      if (controller.signal.aborted) {
        return; // "New chat" cancelled it
      }
      // The cut-off text stays as it was. 409 = not the latest / too old, 404 = conversation expired
      const blocked = err instanceof ChatApiError && (err.status === 409 || err.status === 404);
      this.setContinueNote(msg.id, { text: blocked ? CANNOT_CONTINUE : this.continueError(err), blocked });
    } finally {
      if (this.activeRequest === controller) {
        this.activeRequest = null;
        this.endStream();
        this.loading.set(false);
        this.focusInput();
      }
    }
  }

  private continueError(err: unknown): string {
    // An `error` event carries the backend's own message
    if (err instanceof ChatApiError && err.message === 'Stream error' && typeof err.detail === 'string' && err.detail) {
      return err.detail;
    }
    return this.friendlyError(err);
  }

  private setContinueNote(msgId: number, note: ContinueNote | null) {
    this.continueNotes.update(notes => {
      const next = { ...notes };
      if (note) {
        next[msgId] = note;
      } else {
        delete next[msgId];
      }
      return next;
    });
  }

  private addCost(a: UsageCost | undefined, b: UsageCost | undefined): UsageCost {
    if (typeof a === 'number' && typeof b === 'number') {
      return a + b;
    }
    return b ?? a ?? null;
  }

  private appendStreamText(text: string) {
    const last = this.streamSegments.at(-1);
    if (last?.type === 'markdown') {
      last.text += text;
    } else {
      this.streamSegments.push({ type: 'markdown', text });
    }
    this.scheduleReveal();
  }

  retry() {
    const failed = this.error();
    if (!failed) {
      return;
    }
    if (!this.message.trim()) {
      this.setMessage(failed.question);
    }
    this.send();
  }

  newChat() {
    const active = this.activeRequest;
    if (active) {
      this.activeRequest = null;
      active.abort();
      this.loading.set(false);
    }
    this.endStream(); // also clears a partial answer left by an error
    this.openRequest++; // a chat that is still loading must not appear afterwards
    this.restoring.set(false);
    // Nothing is sent to the backend: the old chat stays in the history and the next question
    // creates a new conversation
    this.setConversationId(null);
    this.messages.set([]);
    this.error.set(null);
    this.chatNotice.set(null);
    this.sidebarOpen.set(false);
    // A new chat starts with an empty context; the monthly user total carries on
    this.usageVersion++;
    this.contextUsage.set(null);
    this.conversationUsage.set(null);
    this.lastTurnTokens.set(null);
    this.setMessage('');
    this.refreshUsage();
    this.focusInput();
  }

  // The sidebar docks beside the chat on wide panels and is a drawer on narrow ones (same
  // breakpoint as the CSS container queries)
  private sidebarDocked(): boolean {
    return (this.popupEl()?.nativeElement.offsetWidth ?? 0) >= SIDEBAR_DOCK_WIDTH;
  }

  // Top-left button of the chat: expands the docked sidebar, or opens the drawer
  showSidebar() {
    if (this.sidebarDocked()) {
      this.sidebarCollapsed.set(false);
    } else {
      this.sidebarOpen.set(true);
    }
    this.focusAfterRender('app-chat-sidebar .collapse');
  }

  // Top-left button of the sidebar (and the drawer's backdrop): collapses or closes it
  hideSidebar() {
    if (this.sidebarDocked()) {
      this.sidebarCollapsed.set(true);
    }
    this.sidebarOpen.set(false);
    this.focusAfterRender('.sidebar-btn');
  }

  // Rendering is deferred to the next frame in this app, so focus once the element really exists
  private focusAfterRender(selector: string) {
    afterNextRender(() => this.popupEl()?.nativeElement.querySelector<HTMLElement>(selector)?.focus(), {
      injector: this.injector
    });
  }

  // A chat was deleted (or turned out to be gone) from the sidebar: leave it if it is the open one
  onChatDeleted(id: string) {
    removeCachedUsage(id);
    if (this.activeConversationId() === id) {
      this.newChat();
    }
  }

  toggleUsagePanel() {
    this.usagePanelOpen.update(open => !open);
  }

  closeUsagePanel() {
    if (!this.usagePanelOpen()) {
      return;
    }
    this.usagePanelOpen.set(false);
    // Esc / outside click: hand focus back to the button that opened the panel
    setTimeout(() => document.querySelector<HTMLElement>('app-chatbot .usage-trigger')?.focus());
  }

  // After every `done` (normal answers and Continue)
  private applyUsage(response: ChatResponse) {
    const usage: ChatUsage | null | undefined = response.usage;
    if (!usage) {
      return;
    }
    this.usageVersion++;
    this.contextUsage.set(usage.context ?? null);
    this.conversationUsage.set(usage.conversation ?? null);
    this.userUsage.set(usage.user ?? null);
    this.limitUsage.set(usage.limit ?? this.limitUsage());
    this.lastTurnTokens.set(usage.turn?.total_tokens ?? null);
    if (response.model) {
      this.usageModel.set(response.model);
    }
    if (usage.context && response.conversation_id) {
      // Remembered so the context still shows when this chat is reopened later
      setCachedUsage(response.conversation_id, {
        context: usage.context,
        lastTurnTokens: usage.turn?.total_tokens ?? null
      });
    }
  }

  // The context numbers last seen for this conversation, shown until its next answer
  private showCachedUsage(conversationId: string | null) {
    const cached = getCachedUsage(conversationId);
    if (cached) {
      this.contextUsage.set(cached.context);
      this.lastTurnTokens.set(cached.lastTurnTokens);
    }
    return cached;
  }

  // On page load, New chat and when a chat is opened: the counters before the next answer.
  // GET /api/usage only knows the context *limit*; how full the context is comes from the numbers
  // remembered for this conversation, or 0 for a new chat (or one never answered in this browser).
  private async refreshUsage() {
    const version = ++this.usageVersion;
    const conversationId = this.activeConversationId();
    try {
      const usage = await getUsage(conversationId);
      if (usage && version === this.usageVersion) {
        this.conversationUsage.set(usage.conversation);
        this.userUsage.set(usage.user);
        this.limitUsage.set(usage.limit);
        const limit = usage.context?.limit_tokens;
        const cached = getCachedUsage(conversationId)?.context;
        if (cached) {
          // keep the remembered usage, measured against the current limit
          const limitTokens = limit || cached.limit_tokens;
          this.contextUsage.set({
            ...cached,
            limit_tokens: limitTokens,
            percent: limitTokens ? (cached.used_tokens / limitTokens) * 100 : cached.percent
          });
        } else {
          this.contextUsage.set(
            limit ? { used_tokens: 0, percent: 0, turns: 0, max_turns: usage.context?.max_turns ?? 0, limit_tokens: limit } : null
          );
        }
      }
    } catch {
      // usage is informational: stay silent if it can't be loaded
    }
  }

  // "1,000 tokens" under an answer; "cached" when it cost nothing because it came from the cache
  usageText(msg: ChatMessage): string | null {
    if (msg.tokens === null) {
      return null;
    }
    if (!msg.tokens && msg.cached) {
      return 'cached';
    }
    const cost = formatCost(msg.cost);
    return cost ? `${formatTokens(msg.tokens)} · ${cost}` : formatTokens(msg.tokens);
  }

  async copyAnswer(msg: ChatMessage) {
    try {
      await navigator.clipboard.writeText(msg.answer);
      this.copiedId.set(msg.id);
      setTimeout(() => {
        if (this.copiedId() === msg.id) {
          this.copiedId.set(null);
        }
      }, 1500);
    } catch {
      // clipboard unavailable (insecure context / permission denied)
    }
  }

  statusHint(msg: ChatMessage): string | null {
    if (msg.status === 'not_in_docs' && msg.citations.length) {
      return NOT_IN_DOCS_RELATED_HINT;
    }
    return STATUS_HINTS[msg.status] ?? null;
  }

  showStandalone(question: string, standaloneQuestion: string | null): boolean {
    const standalone = standaloneQuestion?.trim();
    return !!standalone && standalone.toLowerCase() !== question.trim().toLowerCase();
  }

  formatLatency(ms: number | null): string {
    return ms === null ? '' : `${(ms / 1000).toFixed(1)} s`;
  }

  latencyTooltip(msg: ChatMessage): string {
    const parts: string[] = [];
    if (msg.model) parts.push(`Model: ${msg.model}`);
    if (msg.latencyMs !== null) parts.push(`Latency: ${msg.latencyMs.toLocaleString()} ms`);
    const t = msg.timings;
    if (t) {
      if (typeof t.total_ms === 'number') parts.push(`Total: ${t.total_ms.toLocaleString()} ms`);
      if (typeof t.first_visible_ms === 'number') parts.push(`First text: ${t.first_visible_ms.toLocaleString()} ms`);
      if (t.cached) parts.push('Cached');
    }
    return parts.join(' · ');
  }

  openLightbox(event: OpenImageEvent) {
    this.lightboxTrigger = event.trigger;
    this.lightboxIndex.set(event.index);
    this.lightboxItems.set(event.items);
  }

  openInlineImage(images: ChatImageItem[], item: ChatImageItem, trigger: HTMLElement) {
    const items = images.filter(i => !this.brokenImages().has(i.url));
    this.openLightbox({ items, index: Math.max(0, items.indexOf(item)), trigger });
  }

  markImageBroken(url: string) {
    this.brokenImages.update(set => new Set(set).add(url));
  }

  closeLightbox() {
    this.lightboxItems.set(null);
    const trigger = this.lightboxTrigger;
    this.lightboxTrigger = null;
    // Return focus to the thumbnail that opened it
    setTimeout(() => {
      if (trigger?.isConnected) {
        trigger.focus();
      }
    });
  }

  // Hover/focus on an [n] marker highlights that source's screenshots
  onCiteHover(msgId: number, event: Event) {
    const cite = (event.target as HTMLElement | null)?.closest?.('[data-cite]');
    const index = cite ? Number(cite.getAttribute('data-cite')) : NaN;
    this.hoveredCite.set(isNaN(index) ? null : { msgId, index });
  }

  clearCiteHover() {
    this.hoveredCite.set(null);
  }

  highlightFor(msgId: number): number | null {
    const hovered = this.hoveredCite();
    return hovered?.msgId === msgId ? hovered.index : null;
  }

  // Shows the stage now if the current one has been visible long enough, otherwise right after it
  private queueStage(stage: StreamStage) {
    const lastQueued = this.stageQueue.at(-1) ?? this.streamView()?.stage;
    if (stage === lastQueued) {
      return;
    }
    this.stageQueue.push(stage);
    if (this.stageTimer === null) {
      const wait = this.streamView()?.stage ? STAGE_MIN_VISIBLE_MS - (Date.now() - this.stageShownAt) : 0;
      this.stageTimer = setTimeout(() => this.showNextStage(), Math.max(0, wait));
    }
  }

  private showNextStage() {
    this.stageTimer = null;
    const stage = this.stageQueue.shift();
    if (!stage) {
      return;
    }
    this.stageShownAt = Date.now();
    this.updateStream(view => ({ ...view, stage }));
    if (this.stageQueue.length) {
      this.stageTimer = setTimeout(() => this.showNextStage(), STAGE_MIN_VISIBLE_MS);
    }
  }

  private clearStageQueue() {
    if (this.stageTimer !== null) {
      clearTimeout(this.stageTimer);
      this.stageTimer = null;
    }
    this.stageQueue = [];
  }

  private updateStream(fn: (view: StreamView) => StreamView) {
    this.streamView.update(view => (view ? fn(view) : view));
  }

  // Markdown is re-rendered at most once per animation frame, however fast deltas arrive
  private scheduleStreamRender() {
    if (this.renderFrame === null) {
      this.renderFrame = requestAnimationFrame(() => {
        this.renderFrame = null;
        this.renderStream();
      });
    }
  }

  private renderStream() {
    const view = this.streamView();
    if (!view) {
      return;
    }
    const el = this.body()?.nativeElement;
    const following = !!el && el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_SCROLL_THRESHOLD_PX;

    // Reuse unchanged blocks so only the growing text (and new images) touch the DOM
    const previous = view.blocks;
    const blocks = this.toDisplayBlocks(this.shownSegments(), [], this.streamSources).map((block, i) => {
      const prev = previous[i];
      if (block.kind === 'markdown' && prev?.kind === 'markdown' && prev.raw === block.raw) {
        return prev;
      }
      if (block.kind === 'image' && prev?.kind === 'image' && prev.item.url === block.item.url) {
        return prev;
      }
      return block;
    });
    const inlineImages = blocks.flatMap(block => (block.kind === 'image' ? [block.item] : []));
    const fresh =
      view.fresh && this.revealCursor.seg === this.revealStart.seg && this.revealCursor.chars === this.revealStart.chars;
    this.streamView.set({ ...view, blocks, inlineImages, fresh });

    // Keep following the answer unless the user scrolled up to read
    if (following) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }

  // --- Typewriter: `shown` trails `received` by whole words ---

  private scheduleReveal() {
    if (document.hidden) {
      // Background tab: animation frames are paused, which would stall the answer (and `done`)
      this.revealInstantly();
      return;
    }
    if (this.revealFrame === null) {
      this.revealFrame = requestAnimationFrame(() => this.revealTick());
      // Some environments report the page as visible yet never run animation frames
      this.revealWatchdog = setTimeout(() => {
        this.revealWatchdog = null;
        if (this.revealFrame !== null) {
          this.revealInstantly();
        }
      }, REVEAL_FRAME_TIMEOUT_MS);
    }
  }

  private cancelRevealFrame() {
    if (this.revealFrame !== null) {
      cancelAnimationFrame(this.revealFrame);
      this.revealFrame = null;
    }
    if (this.revealWatchdog !== null) {
      clearTimeout(this.revealWatchdog);
      this.revealWatchdog = null;
    }
  }

  private revealInstantly() {
    this.cancelRevealFrame();
    if (this.revealAll(this.revealFlush)) {
      this.renderStream();
    }
    if (this.revealFlush && this.revealCursor.seg >= this.streamSegments.length) {
      this.resolveRevealWaiter();
    }
  }

  // The tab went to the background mid-answer: a pending frame would never fire, so catch up now
  private onVisibilityChange() {
    if (document.hidden && this.revealFrame !== null) {
      this.revealInstantly();
    }
  }

  private revealTick() {
    this.revealFrame = null;
    this.cancelRevealFrame(); // clears the watchdog
    const progressed = this.reducedMotion
      ? this.revealAll(this.revealFlush)
      : this.advanceReveal(Math.max(1, Math.ceil(this.backlogWords() / REVEAL_BACKLOG_DIVISOR)), this.revealFlush);
    if (progressed) {
      this.renderStream();
    }
    if (this.revealFlush && this.revealCursor.seg >= this.streamSegments.length) {
      this.resolveRevealWaiter();
    } else if (progressed) {
      this.scheduleReveal();
    }
    // Otherwise wait: only an unfinished word is left, and the next delta restarts the loop
  }

  // Resolves once everything received is on screen (called when `done` arrives)
  private finishReveal(): Promise<void> {
    this.revealFlush = true;
    if (this.revealCursor.seg >= this.streamSegments.length) {
      return Promise.resolve();
    }
    return new Promise(resolve => {
      this.revealWaiter = resolve;
      this.scheduleReveal();
    });
  }

  private resolveRevealWaiter() {
    const resolve = this.revealWaiter;
    this.revealWaiter = null;
    resolve?.();
  }

  /** Reveals up to `words` whole words (images appear when reached). Returns whether anything changed. */
  private advanceReveal(words: number, flush: boolean): boolean {
    const segments = this.streamSegments;
    const cursor = this.revealCursor;
    let progressed = false;

    while (cursor.seg < segments.length) {
      const seg = segments[cursor.seg];
      if (seg.type === 'image') {
        cursor.seg++;
        cursor.chars = 0;
        progressed = true;
        continue;
      }
      const rest = seg.text.slice(cursor.chars);
      if (words > 0) {
        const word = NEXT_WORD_RE.exec(rest);
        if (word) {
          cursor.chars += word[0].length;
          words--;
          progressed = true;
          continue;
        }
      }
      // No complete word left here. A closed buffer (an image or more text follows it) or the final
      // flush may reveal its last word and trailing whitespace; an open buffer waits for more text.
      const closed = cursor.seg < segments.length - 1 || flush;
      const hasText = /\S/.test(rest);
      if (closed && (words > 0 || !hasText)) {
        if (hasText) {
          words--;
        }
        cursor.seg++;
        cursor.chars = 0;
        progressed = true;
        continue;
      }
      break;
    }
    return progressed;
  }

  /** Shows everything received at once (reduced motion, errors). Returns whether anything changed. */
  private revealAll(flush: boolean): boolean {
    const segments = this.streamSegments;
    const before = `${this.revealCursor.seg}:${this.revealCursor.chars}`;
    const last = segments.at(-1);
    if (flush || !last || last.type === 'image') {
      this.revealCursor = { seg: segments.length, chars: 0 };
    } else {
      this.revealCursor = { seg: segments.length - 1, chars: last.text.length };
    }
    return before !== `${this.revealCursor.seg}:${this.revealCursor.chars}`;
  }

  private backlogWords(): number {
    let count = 0;
    for (let i = this.revealCursor.seg; i < this.streamSegments.length; i++) {
      const seg = this.streamSegments[i];
      if (seg.type === 'markdown') {
        const text = i === this.revealCursor.seg ? seg.text.slice(this.revealCursor.chars) : seg.text;
        count += text.match(/\S+/g)?.length ?? 0;
      }
    }
    return count;
  }

  private shownSegments(): Segment[] {
    const { seg, chars } = this.revealCursor;
    const shown = this.streamSegments.slice(0, seg);
    const current = this.streamSegments[seg];
    if (current?.type === 'markdown' && chars > 0) {
      shown.push({ type: 'markdown', text: current.text.slice(0, chars) });
    }
    return shown;
  }

  private prefersReducedMotion(): boolean {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  }

  private stopFrames() {
    if (this.renderFrame !== null) {
      cancelAnimationFrame(this.renderFrame);
      this.renderFrame = null;
    }
    this.cancelRevealFrame();
  }

  private endStream() {
    this.stopFrames();
    this.clearStageQueue();
    this.resolveRevealWaiter(); // an aborted send() must not stay parked on finishReveal()
    this.streamView.set(null);
    this.streamSegments = [];
    this.streamSources = [];
    this.revealCursor = { seg: 0, chars: 0 };
    this.revealStart = { seg: 0, chars: 0 };
    this.revealFlush = false;
  }

  // After an error: keep the partial answer on screen (no sparkle) until the next send / New chat
  private freezeStream() {
    this.stopFrames();
    this.clearStageQueue();
    this.resolveRevealWaiter();
    this.updateStream(view => ({ ...view, stage: null, interrupted: true }));
  }

  /** Opens a past chat from the sidebar and makes it the current conversation. */
  async openConversation(id: string) {
    this.sidebarOpen.set(false);
    if (id === this.activeConversationId() && !this.restoring()) {
      return;
    }
    // Leave whatever is on screen: cancel a running answer, drop the old messages
    const active = this.activeRequest;
    if (active) {
      this.activeRequest = null;
      active.abort();
      this.loading.set(false);
    }
    this.endStream();
    const request = ++this.openRequest;
    this.usageVersion++;
    this.contextUsage.set(null);
    this.conversationUsage.set(null);
    this.lastTurnTokens.set(null);
    this.messages.set([]);
    this.error.set(null);
    this.chatNotice.set(null);
    this.setConversationId(id);
    this.showCachedUsage(id); // straight away, without waiting for the network
    this.restoring.set(true);

    try {
      const conversation = await getConversation(id);
      if (request !== this.openRequest) {
        return; // another chat (or New chat) was chosen meanwhile
      }
      this.messages.set(
        (conversation.turns ?? []).map(turn =>
          this.buildMessage({
            conversationId: id,
            turnId: turn.id ?? null,
            question: turn.question,
            standaloneQuestion: turn.standalone_question,
            answer: turn.answer,
            segments: turn.segments,
            status: turn.status,
            citations: turn.citations ?? [],
            sources: [],
            model: null,
            latencyMs: null,
            timings: null,
            tokens: null,
            cost: null,
            cached: false,
            images: turn.images ?? []
          })
        )
      );
      this.scrollToBottom();
      this.refreshUsage();
    } catch (err) {
      if (request !== this.openRequest) {
        return;
      }
      this.setConversationId(null);
      if (err instanceof ChatApiError && err.status === 404) {
        this.history.remove(id); // expired
        removeCachedUsage(id);
        this.chatNotice.set('This chat is no longer available.');
      } else {
        this.chatNotice.set("Couldn't open this chat. Please try again.");
      }
    } finally {
      if (request === this.openRequest) {
        this.restoring.set(false);
        this.focusInput();
      }
    }
  }

  private fromResponse(res: ChatResponse): ChatMessage {
    return this.buildMessage({
      conversationId: res.conversation_id,
      turnId: res.turn_id ?? null,
      question: res.question,
      standaloneQuestion: res.standalone_question,
      answer: res.answer,
      segments: res.segments,
      status: res.status,
      citations: res.citations ?? [],
      sources: res.sources ?? [],
      model: res.model,
      latencyMs: res.latency_ms,
      timings: res.timings ?? null,
      tokens: res.usage?.turn ? res.usage.turn.total_tokens ?? 0 : null,
      cost: res.usage?.turn?.cost ?? null,
      cached: !!res.timings?.cached,
      images: res.images ?? []
    });
  }

  private toDisplayBlocks(segments: Segment[], citations: Source[], sources: Source[]): DisplayBlock[] {
    // Markdown html comes from renderAnswer, which escapes raw HTML and sanitises with DOMPurify,
    // so bypassing Angular's sanitiser is safe
    return buildAnswerBlocks(segments, citations, sources).map(block =>
      block.kind === 'markdown'
        ? { kind: 'markdown', html: this.sanitizer.bypassSecurityTrustHtml(block.html), raw: block.html }
        : block
    );
  }

  private buildMessage(data: Omit<ChatMessage, 'id' | 'blocks' | 'inlineImages' | 'extraImages'>): ChatMessage {
    const blocks = this.toDisplayBlocks(data.segments, data.citations, data.sources);
    const inlineImages = blocks.flatMap(block => (block.kind === 'image' ? [block.item] : []));

    const byIndex = new Map<number, Source>();
    for (const s of data.sources) byIndex.set(s.index, s);
    for (const s of data.citations) byIndex.set(s.index, s);

    const inlineUrls = new Set(inlineImages.map(item => item.url));
    const extraImages = data.images
      .filter(img => !img.placed && !inlineUrls.has(img.url))
      .map(img => toImageItem(img, img.source_index, byIndex.get(img.source_index)))
      .filter((item): item is ChatImageItem => item !== null);

    return { ...data, id: this.nextId++, blocks, inlineImages, extraImages };
  }

  private friendlyError(err: unknown): string {
    if (err instanceof ChatApiError) {
      switch (err.status) {
        case 0:
          if (err.message === 'Request timed out') {
            return 'The assistant took too long to respond.';
          }
          if (err.message === 'Stream interrupted') {
            return 'The answer was interrupted. Please try again.';
          }
          return "Couldn't reach the help assistant. Check your connection and try again.";
        case 422:
          return typeof err.detail === 'string'
            ? err.detail
            : "That question couldn't be processed. Please check it and try again.";
        case 502:
          return 'The assistant is temporarily unavailable. Please try again in a moment.';
        case 503:
          return "The assistant isn't available right now. Please try again later.";
      }
    }
    return 'Something went wrong. Please try again.';
  }

  private setConversationId(id: string | null) {
    this.activeConversationId.set(id);
  }

  // Earlier versions kept the open conversation's id in browser storage; drop those copies
  private removeLegacyStoredId() {
    try {
      sessionStorage.removeItem(LEGACY_CONVERSATION_KEY);
      localStorage.removeItem(LEGACY_CONVERSATION_KEY);
    } catch {
      // storage unavailable
    }
  }

  private scrollToBottom() {
    setTimeout(() => {
      const el = this.body()?.nativeElement;
      if (el) {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      }
    });
  }

  // Long answers: show the newest question + the start of its answer rather than the answer's end
  private scrollToLatestQuestion() {
    setTimeout(() => {
      const el = this.body()?.nativeElement;
      const bubbles = el?.querySelectorAll<HTMLElement>('.bubble.user');
      const last = bubbles?.[bubbles.length - 1];
      if (el && last) {
        el.scrollTo({ top: last.offsetTop - 12, behavior: 'smooth' });
      }
    });
  }

  // Also writes the DOM value: with event coalescing, typing + Enter can land before change
  // detection records the typed text, so ngModel alone would see '' -> '' and not clear the box
  private setMessage(text: string) {
    this.message = text;
    const el = this.input()?.nativeElement;
    if (el) {
      el.value = text;
    }
  }

  private focusInput() {
    setTimeout(() => this.input()?.nativeElement.focus());
  }
}
