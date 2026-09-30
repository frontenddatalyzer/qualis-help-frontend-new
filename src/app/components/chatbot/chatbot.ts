import { Component, DestroyRef, ElementRef, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import {
  AnswerImage,
  ChatApiError,
  ChatResponse,
  ChatStatus,
  ChatTimings,
  Segment,
  Source,
  StreamStage,
  deleteConversation,
  getConversation,
  sendMessage,
  streamChat
} from '../../api/chat';
import { isSafeUrl } from './render-answer';
import { ChatImageItem, OpenImageEvent, toImageItem } from './chat-images';
import { buildAnswerBlocks } from './answer-blocks';
import { ChatThumbnails } from './chat-thumbnails/chat-thumbnails';
import { ChatLightbox } from './chat-lightbox/chat-lightbox';
import { ChatScreenshot } from './chat-screenshot/chat-screenshot';

type DisplayBlock =
  // `raw` is the html string behind `html`, kept to reuse unchanged blocks while streaming
  | { kind: 'markdown'; html: SafeHtml; raw: string }
  | { kind: 'image'; item: ChatImageItem };

interface ChatMessage {
  id: number;
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
}

interface ChatError {
  message: string;
  question: string;
}

const STORAGE_KEY = 'qualis-help-chat-conversation-id';
const MAX_QUESTION_LENGTH = 2000;
const STREAM_ID = -1; // message id used for hover highlighting inside the streaming answer
const FOLLOW_SCROLL_THRESHOLD_PX = 80;
// Typewriter: each frame reveals max(1, backlog / 20) words
const REVEAL_BACKLOG_DIVISOR = 20;
// A complete word: it must be followed by whitespace, or it may still be growing
const NEXT_WORD_RE = /^\s*\S+(?=\s)/;

const STAGE_LABELS: Record<StreamStage, string> = {
  searching: 'Searching the documentation…',
  generating: 'Writing the answer…',
  thinking: 'Thinking…'
};

const STATUS_HINTS: Partial<Record<ChatStatus, string>> = {
  not_in_docs: "The documentation doesn't cover this.",
  no_relevant_docs: 'No relevant documentation found — try rephrasing or naming the product version.',
  ungrounded: "This answer isn't backed by citations — verify it.",
  truncated: 'The answer was cut off.'
};

@Component({
  selector: 'app-chatbot',
  imports: [FormsModule, NgTemplateOutlet, ChatThumbnails, ChatLightbox, ChatScreenshot],
  templateUrl: './chatbot.html',
  styleUrl: './chatbot.scss'
})
export class Chatbot {
  private sanitizer = inject(DomSanitizer);
  private body = viewChild<ElementRef<HTMLElement>>('chatBody');
  private input = viewChild<ElementRef<HTMLInputElement>>('chatInput');

  readonly maxLength = MAX_QUESTION_LENGTH;
  readonly statusHints = STATUS_HINTS;
  readonly isSafeUrl = isSafeUrl;
  readonly streamId = STREAM_ID;

  isOpen = signal(false);
  message = '';

  messages = signal<ChatMessage[]>([]);
  streamView = signal<StreamView | null>(null);
  loading = signal(false);
  restoring = signal(false);
  error = signal<ChatError | null>(null);
  copiedId = signal<number | null>(null);

  stageLabel = computed(() => {
    const stage = this.streamView()?.stage;
    return (stage && STAGE_LABELS[stage]) || 'Thinking…';
  });

  // Screenshots
  lightboxItems = signal<ChatImageItem[] | null>(null);
  lightboxIndex = signal(0);
  hoveredCite = signal<{ msgId: number; index: number } | null>(null);
  private brokenImages = signal<ReadonlySet<string>>(new Set());
  private lightboxTrigger: HTMLElement | null = null;

  hasConversation = computed(
    () => this.messages().length > 0 || this.streamView() !== null || this.error() !== null || this.restoring()
  );

  private conversationId: string | null = null;
  private nextId = 1;

  // In-flight request (streaming or fallback)
  private activeRequest: AbortController | null = null;
  // Everything received so far: text buffers and images, in order ("received")
  private streamSegments: Segment[] = [];
  private streamSources: Source[] = [];
  private renderFrame: number | null = null;
  // Typewriter: segments before `seg` are fully shown, plus `chars` characters of segment `seg` ("shown")
  private revealCursor = { seg: 0, chars: 0 };
  private revealFrame: number | null = null;
  private revealFlush = false; // `done` arrived: also reveal the last (possibly unterminated) word
  private revealWaiter: (() => void) | null = null;
  private reducedMotion = false;
  private visibilityListener = () => this.onVisibilityChange();

  constructor() {
    // Browser only (localStorage + DOMPurify); skipped during SSR
    afterNextRender(() => {
      this.restoreConversation();
      document.addEventListener('visibilitychange', this.visibilityListener);
    });
    inject(DestroyRef).onDestroy(() => {
      this.activeRequest?.abort();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', this.visibilityListener);
      }
    });
  }

  toggle() {
    this.isOpen.update(open => !open);
    if (this.isOpen()) {
      this.scrollToBottom();
      this.focusInput();
    }
  }

  async send() {
    const question = this.message.trim();
    // One request at a time: the conversation is ordered
    if (!question || this.loading() || question.length > MAX_QUESTION_LENGTH) {
      return;
    }

    this.error.set(null);
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
      interrupted: false
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
          this.conversationId,
          {
            onStart: event => {
              started = true;
              this.setConversationId(event.conversation_id);
            },
            onStatus: event => this.updateStream(view => ({ ...view, stage: event.stage })),
            onRetrieved: event => {
              this.streamSources = event.sources; // makes [n] markers clickable
              this.updateStream(view => ({ ...view, standaloneQuestion: event.standalone_question }));
              this.scheduleStreamRender();
            },
            // Deltas and images only extend what was received; the typewriter decides what is shown
            onDelta: event => {
              streamedContent = true;
              const last = this.streamSegments.at(-1);
              if (last?.type === 'markdown') {
                last.text += event.text;
              } else {
                this.streamSegments.push({ type: 'markdown', text: event.text });
              }
              this.scheduleReveal();
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
        response = await sendMessage(question, this.conversationId, controller.signal);
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
    const id = this.conversationId;
    this.setConversationId(null);
    this.messages.set([]);
    this.error.set(null);
    this.setMessage('');
    if (id) {
      deleteConversation(id).catch(() => {
        // ignored: the backend forgets idle conversations anyway
      });
    }
    this.focusInput();
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
    this.streamView.set({ ...view, blocks, inlineImages });

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
    }
  }

  private revealInstantly() {
    if (this.revealFrame !== null) {
      cancelAnimationFrame(this.revealFrame);
      this.revealFrame = null;
    }
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
    if (this.revealFrame !== null) {
      cancelAnimationFrame(this.revealFrame);
      this.revealFrame = null;
    }
  }

  private endStream() {
    this.stopFrames();
    this.resolveRevealWaiter(); // an aborted send() must not stay parked on finishReveal()
    this.streamView.set(null);
    this.streamSegments = [];
    this.streamSources = [];
    this.revealCursor = { seg: 0, chars: 0 };
    this.revealFlush = false;
  }

  // After an error: keep the partial answer on screen (no sparkle) until the next send / New chat
  private freezeStream() {
    this.stopFrames();
    this.resolveRevealWaiter();
    this.updateStream(view => ({ ...view, stage: null, interrupted: true }));
  }

  private async restoreConversation() {
    const id = this.readStoredId();
    if (!id) {
      return;
    }
    this.conversationId = id;
    this.restoring.set(true);
    try {
      const conversation = await getConversation(id);
      this.messages.set(
        (conversation.turns ?? []).map(turn =>
          this.buildMessage({
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
            images: turn.images ?? []
          })
        )
      );
      this.scrollToBottom();
    } catch (err) {
      if (err instanceof ChatApiError && err.status === 404) {
        this.setConversationId(null);
      }
      // other failures: keep the id; the next message continues (or the backend restarts) the conversation
    } finally {
      this.restoring.set(false);
    }
  }

  private fromResponse(res: ChatResponse): ChatMessage {
    return this.buildMessage({
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
    this.conversationId = id;
    try {
      if (id) {
        localStorage.setItem(STORAGE_KEY, id);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // storage unavailable (private mode, blocked site data)
    }
  }

  private readStoredId(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
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
