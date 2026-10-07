import { Injectable, WritableSignal, signal } from '@angular/core';
import { FeedbackRating } from '../../../api/chat';

export interface FeedbackState {
  rating: FeedbackRating | null;
  comment: string; // draft of the "What was wrong?" box
  commentOpen: boolean;
  sending: boolean;
  note: string | null; // quiet line under the buttons
  expired: boolean; // backend no longer knows this answer (404)
  commentSent: boolean; // a thumbs-down reason was submitted: the vote can no longer change to thumbs-up
}

const INITIAL: FeedbackState = {
  rating: null,
  comment: '',
  commentOpen: false,
  sending: false,
  note: null,
  expired: false,
  commentSent: false
};

// In-memory feedback state per answer (turn id). Lives outside the chat popup, which is destroyed
// when minimized, so votes stay selected for as long as the page is open.
@Injectable({ providedIn: 'root' })
export class ChatFeedbackStore {
  private states = new Map<string, WritableSignal<FeedbackState>>();

  for(turnId: string): WritableSignal<FeedbackState> {
    let state = this.states.get(turnId);
    if (!state) {
      state = signal({ ...INITIAL });
      this.states.set(turnId, state);
    }
    return state;
  }
}
