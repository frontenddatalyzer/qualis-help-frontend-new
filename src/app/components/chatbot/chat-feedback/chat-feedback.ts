import { Component, computed, inject, input } from '@angular/core';
import { ChatApiError, FEEDBACK_COMMENT_MAX_LENGTH, FeedbackRating, sendFeedback } from '../../../api/chat';
import { ChatFeedbackStore, FeedbackState } from './chat-feedback.store';

// Thumbs up / down for one answer, plus an optional "What was wrong?" comment after a thumbs-down
@Component({
  selector: 'app-chat-feedback',
  templateUrl: './chat-feedback.html',
  styleUrl: './chat-feedback.scss'
})
export class ChatFeedback {
  conversationId = input.required<string>();
  turnId = input.required<string>();

  private store = inject(ChatFeedbackStore);
  private stateSignal = computed(() => this.store.for(this.turnId()));
  state = computed(() => this.stateSignal()());

  readonly commentMaxLength = FEEDBACK_COMMENT_MAX_LENGTH;

  async vote(rating: FeedbackRating) {
    const previous = this.state();
    if (previous.sending || previous.expired) {
      return;
    }
    if (rating === 'up' && previous.commentSent) {
      return; // a reason for the thumbs-down was already sent
    }
    if (previous.rating === rating) {
      // Same vote again: nothing to send; a thumbs-down just reopens the comment box
      if (rating === 'down') {
        this.patch({ commentOpen: true });
      }
      return;
    }

    this.patch({ rating, commentOpen: rating === 'down', note: null, sending: true });
    try {
      await sendFeedback(this.conversationId(), this.turnId(), rating);
      this.patch({ sending: false });
    } catch (err) {
      if (this.isExpired(err)) {
        return;
      }
      // Put the previous vote back
      this.patch({
        rating: previous.rating,
        commentOpen: previous.commentOpen,
        sending: false,
        note: "Couldn't send your feedback. Please try again."
      });
    }
  }

  setComment(event: Event) {
    this.patch({ comment: (event.target as HTMLTextAreaElement).value });
  }

  async sendComment() {
    const state = this.state();
    const comment = state.comment.trim();
    if (!comment || state.sending || state.expired) {
      return;
    }
    this.patch({ sending: true, note: null });
    try {
      // Same rating again, now with the comment: the backend keeps the latest feedback per answer
      await sendFeedback(this.conversationId(), this.turnId(), 'down', comment);
      this.patch({
        sending: false,
        commentOpen: false,
        comment: '',
        commentSent: true,
        note: 'Thanks — your feedback was sent.'
      });
    } catch (err) {
      if (this.isExpired(err)) {
        return;
      }
      this.patch({ sending: false, note: "Couldn't send your comment. Please try again." });
    }
  }

  private isExpired(err: unknown): boolean {
    if (err instanceof ChatApiError && err.status === 404) {
      this.patch({
        rating: null,
        commentOpen: false,
        sending: false,
        expired: true,
        note: 'This answer can no longer be rated.'
      });
      return true;
    }
    return false;
  }

  private patch(change: Partial<FeedbackState>) {
    this.stateSignal().update(state => ({ ...state, ...change }));
  }
}
