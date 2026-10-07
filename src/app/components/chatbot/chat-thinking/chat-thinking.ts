import { Component, input } from '@angular/core';

// Claude-style status: pulsing sparkle, plus shimmering text when a label is given (no bubble)
@Component({
  selector: 'app-chat-thinking',
  templateUrl: './chat-thinking.html',
  styleUrl: './chat-thinking.scss',
  host: { role: 'status', 'aria-live': 'polite' }
})
export class ChatThinking {
  label = input<string | null>(null);
}
