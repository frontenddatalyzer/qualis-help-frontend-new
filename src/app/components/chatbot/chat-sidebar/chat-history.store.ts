import { Injectable, signal } from '@angular/core';
import {
  ChatApiError,
  ConversationSummary,
  deleteConversation,
  listConversations,
  renameConversation
} from '../../../api/chat';

// The chat history list for this browser, shared by the sidebar and the chat
@Injectable({ providedIn: 'root' })
export class ChatHistoryStore {
  conversations = signal<ConversationSummary[]>([]);
  loaded = signal(false);
  loadFailed = signal(false);

  private version = 0; // a slow list request must not overwrite a newer result or a local change

  /** Loads the list; called on page load and after every answer. Keeps the old list if it fails. */
  async refresh(): Promise<void> {
    const version = ++this.version;
    try {
      const list = await listConversations();
      if (version === this.version) {
        this.conversations.set(list);
        this.loadFailed.set(false);
        this.loaded.set(true);
      }
    } catch {
      if (version === this.version) {
        this.loadFailed.set(true);
        this.loaded.set(true);
      }
    }
  }

  titleOf(id: string | null): string | null {
    return (id && this.conversations().find(c => c.conversation_id === id)?.title) || null;
  }

  /** Drops a chat from the list locally (it expired or was deleted). */
  remove(id: string) {
    this.version++;
    this.conversations.update(list => list.filter(c => c.conversation_id !== id));
  }

  /** Renames a chat. Returns false when it no longer exists (it is then removed from the list). */
  async rename(id: string, title: string): Promise<boolean> {
    try {
      const stored = await renameConversation(id, title);
      this.version++;
      this.conversations.update(list => list.map(c => (c.conversation_id === id ? { ...c, title: stored } : c)));
      return true;
    } catch (err) {
      if (err instanceof ChatApiError && err.status === 404) {
        this.remove(id);
        return false;
      }
      throw err;
    }
  }

  /** Deletes a chat; one that is already gone (404) counts as deleted. */
  async delete(id: string): Promise<void> {
    try {
      await deleteConversation(id);
    } catch (err) {
      if (!(err instanceof ChatApiError && err.status === 404)) {
        throw err;
      }
    }
    this.remove(id);
  }
}
