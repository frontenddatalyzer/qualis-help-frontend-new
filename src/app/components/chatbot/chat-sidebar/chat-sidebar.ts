import { Component, ElementRef, HostListener, Injector, afterNextRender, computed, inject, input, output, signal } from '@angular/core';
import { CONVERSATION_TITLE_MAX_LENGTH, ConversationSummary } from '../../../api/chat';
import { ChatHistoryStore } from './chat-history.store';

interface HistoryGroup {
  label: string;
  items: ConversationSummary[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Chat history, like Claude's sidebar: "New chat", then past chats grouped by date, each with a
// rename / delete menu. Docked beside the chat when the panel is wide, otherwise a drawer.
@Component({
  selector: 'app-chat-sidebar',
  templateUrl: './chat-sidebar.html',
  styleUrl: './chat-sidebar.scss',
  host: { '[class.open]': 'open()', '[class.collapsed]': 'collapsed()' }
})
export class ChatSidebar {
  activeId = input<string | null>(null);
  open = input(false); // drawer state on narrow panels (ignored when docked)
  collapsed = input(false); // hidden by the user while docked (ignored as a drawer)

  newChat = output<void>();
  openChat = output<string>();
  deleted = output<string>(); // a chat was deleted (the parent leaves it if it was open)
  closed = output<void>(); // hide requested: closes the drawer / collapses the docked sidebar

  store = inject(ChatHistoryStore);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private injector = inject(Injector);

  readonly titleMaxLength = CONVERSATION_TITLE_MAX_LENGTH;

  menuFor = signal<string | null>(null);
  renaming = signal<string | null>(null);
  confirmingDelete = signal<string | null>(null);
  busy = signal<string | null>(null);
  note = signal<string | null>(null);

  groups = computed<HistoryGroup[]>(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const buckets: HistoryGroup[] = [
      { label: 'Today', items: [] },
      { label: 'Yesterday', items: [] },
      { label: 'Previous 7 days', items: [] },
      { label: 'Older', items: [] }
    ];
    for (const chat of this.store.conversations()) {
      const updated = (chat.updated_at ?? chat.created_at ?? 0) * 1000; // Unix seconds
      const index = updated >= today ? 0 : updated >= today - DAY_MS ? 1 : updated >= today - 7 * DAY_MS ? 2 : 3;
      buckets[index].items.push(chat);
    }
    return buckets.filter(group => group.items.length);
  });

  select(chat: ConversationSummary) {
    if (this.renaming() !== chat.conversation_id) {
      this.resetRowState();
      this.openChat.emit(chat.conversation_id);
    }
  }

  toggleMenu(id: string, event: Event) {
    event.stopPropagation();
    this.confirmingDelete.set(null);
    this.menuFor.update(current => (current === id ? null : id));
  }

  startRename(id: string) {
    this.menuFor.set(null);
    this.note.set(null);
    this.renaming.set(id);
    // Focus + select the title once the input is really in the DOM (rendering is deferred to the
    // next frame in this app, so a plain timeout can run too early)
    afterNextRender(
      () => {
        const field = this.host.nativeElement.querySelector<HTMLInputElement>('.rename-input');
        field?.focus();
        field?.select();
      },
      { injector: this.injector }
    );
  }

  cancelRename() {
    this.renaming.set(null);
  }

  async commitRename(chat: ConversationSummary, value: string) {
    if (this.renaming() !== chat.conversation_id) {
      return; // already handled (Enter is followed by a blur)
    }
    this.renaming.set(null);
    const title = value.trim().slice(0, CONVERSATION_TITLE_MAX_LENGTH);
    if (!title || title === chat.title) {
      return; // empty or unchanged: keep the old title
    }
    this.busy.set(chat.conversation_id);
    try {
      if (!(await this.store.rename(chat.conversation_id, title))) {
        this.note.set('This chat is no longer available.');
        this.deleted.emit(chat.conversation_id);
      }
    } catch {
      this.note.set("Couldn't rename the chat. Please try again.");
    } finally {
      this.busy.set(null);
    }
  }

  askDelete(id: string) {
    this.menuFor.set(null);
    this.note.set(null);
    this.confirmingDelete.set(id);
  }

  async confirmDelete(id: string) {
    this.confirmingDelete.set(null);
    this.busy.set(id);
    try {
      await this.store.delete(id);
      this.deleted.emit(id);
    } catch {
      this.note.set("Couldn't delete the chat. Please try again.");
    } finally {
      this.busy.set(null);
    }
  }

  retryLoad() {
    this.store.refresh();
  }

  // Close the row menu / delete confirmation when clicking elsewhere or pressing Escape
  @HostListener('document:click')
  @HostListener('document:keydown.escape')
  resetRowState() {
    this.menuFor.set(null);
    this.confirmingDelete.set(null);
  }
}
