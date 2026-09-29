import { Component, ElementRef, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import {
  AnswerImage,
  ChatApiError,
  ChatResponse,
  ChatStatus,
  Segment,
  Source,
  deleteConversation,
  getConversation,
  sendMessage
} from '../../api/chat';
import { isSafeUrl } from './render-answer';
import { ChatImageItem, OpenImageEvent, toImageItem } from './chat-images';
import { buildAnswerBlocks } from './answer-blocks';
import { ChatThumbnails } from './chat-thumbnails/chat-thumbnails';
import { ChatLightbox } from './chat-lightbox/chat-lightbox';
import { ChatScreenshot } from './chat-screenshot/chat-screenshot';

type DisplayBlock =
  | { kind: 'markdown'; html: SafeHtml }
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
  images: AnswerImage[];
  blocks: DisplayBlock[]; // text and inline screenshots in reading order
  inlineImages: ChatImageItem[]; // the inline screenshots, in order (lightbox walks these)
  extraImages: ChatImageItem[]; // placed=false: shown under "More screenshots"
}

interface ChatError {
  message: string;
  question: string;
}

const STORAGE_KEY = 'qualis-help-chat-conversation-id';
const MAX_QUESTION_LENGTH = 2000;

const STATUS_HINTS: Partial<Record<ChatStatus, string>> = {
  not_in_docs: "The documentation doesn't cover this.",
  no_relevant_docs: 'No relevant documentation found — try rephrasing or naming the product version.',
  ungrounded: "This answer isn't backed by citations — verify it.",
  truncated: 'The answer was cut off.'
};

@Component({
  selector: 'app-chatbot',
  imports: [FormsModule, ChatThumbnails, ChatLightbox, ChatScreenshot],
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

  isOpen = signal(false);
  message = '';

  messages = signal<ChatMessage[]>([]);
  pendingQuestion = signal<string | null>(null);
  loading = signal(false);
  restoring = signal(false);
  error = signal<ChatError | null>(null);
  copiedId = signal<number | null>(null);

  // Screenshots
  lightboxItems = signal<ChatImageItem[] | null>(null);
  lightboxIndex = signal(0);
  hoveredCite = signal<{ msgId: number; index: number } | null>(null);
  private brokenImages = signal<ReadonlySet<string>>(new Set());
  private lightboxTrigger: HTMLElement | null = null;

  hasConversation = computed(
    () => this.messages().length > 0 || this.pendingQuestion() !== null || this.error() !== null || this.restoring()
  );

  private conversationId: string | null = null;
  private nextId = 1;

  constructor() {
    // Browser only (localStorage + DOMPurify); skipped during SSR
    afterNextRender(() => this.restoreConversation());
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
    this.pendingQuestion.set(question);
    this.setMessage('');
    this.loading.set(true);
    this.scrollToBottom();

    try {
      const response = await sendMessage(question, this.conversationId);
      // The backend may start a new conversation (unknown/expired id), so always keep the latest id
      this.setConversationId(response.conversation_id);
      this.messages.update(list => [...list, this.fromResponse(response)]);
    } catch (err) {
      this.error.set({ message: this.friendlyError(err), question });
      // Keep what the user typed so nothing is lost
      if (!this.message.trim()) {
        this.setMessage(question);
      }
    } finally {
      this.pendingQuestion.set(null);
      this.loading.set(false);
      if (this.error()) {
        this.scrollToBottom();
      } else {
        this.scrollToLatestQuestion();
      }
      this.focusInput();
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
    if (this.loading()) {
      return;
    }
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

  showStandalone(msg: ChatMessage): boolean {
    const standalone = msg.standaloneQuestion?.trim();
    return !!standalone && standalone.toLowerCase() !== msg.question.trim().toLowerCase();
  }

  formatLatency(ms: number | null): string {
    return ms === null ? '' : `${(ms / 1000).toFixed(1)} s`;
  }

  latencyTooltip(msg: ChatMessage): string {
    const parts: string[] = [];
    if (msg.model) parts.push(`Model: ${msg.model}`);
    if (msg.latencyMs !== null) parts.push(`Latency: ${msg.latencyMs.toLocaleString()} ms`);
    return parts.join(' · ');
  }

  openLightbox(event: OpenImageEvent) {
    this.lightboxTrigger = event.trigger;
    this.lightboxIndex.set(event.index);
    this.lightboxItems.set(event.items);
  }

  openInlineImage(msg: ChatMessage, item: ChatImageItem, trigger: HTMLElement) {
    const items = msg.inlineImages.filter(i => !this.brokenImages().has(i.url));
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

  // Hover/focus on an [n] marker highlights that source's thumbnails
  onCiteHover(msg: ChatMessage, event: Event) {
    const cite = (event.target as HTMLElement | null)?.closest?.('[data-cite]');
    const index = cite ? Number(cite.getAttribute('data-cite')) : NaN;
    this.hoveredCite.set(isNaN(index) ? null : { msgId: msg.id, index });
  }

  clearCiteHover() {
    this.hoveredCite.set(null);
  }

  highlightFor(msg: ChatMessage): number | null {
    const hovered = this.hoveredCite();
    return hovered?.msgId === msg.id ? hovered.index : null;
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
      images: res.images ?? []
    });
  }

  private buildMessage(data: Omit<ChatMessage, 'id' | 'blocks' | 'inlineImages' | 'extraImages'>): ChatMessage {
    // Markdown html comes from renderAnswer, which escapes raw HTML and sanitises with DOMPurify,
    // so bypassing Angular's sanitiser is safe
    const blocks: DisplayBlock[] = buildAnswerBlocks(data.segments, data.citations, data.sources).map(block =>
      block.kind === 'markdown' ? { kind: 'markdown', html: this.sanitizer.bypassSecurityTrustHtml(block.html) } : block
    );
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
          return err.message === 'Request timed out'
            ? 'The assistant took too long to respond.'
            : "Couldn't reach the help assistant. Check your connection and try again.";
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
