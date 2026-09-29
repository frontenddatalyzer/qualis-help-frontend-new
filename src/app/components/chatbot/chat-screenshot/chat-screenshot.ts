import { Component, input, output, signal } from '@angular/core';
import { ChatImageItem } from '../chat-images';

// A screenshot shown inline under the answer step it illustrates
@Component({
  selector: 'app-chat-screenshot',
  templateUrl: './chat-screenshot.html',
  styleUrl: './chat-screenshot.scss'
})
export class ChatScreenshot {
  item = input.required<ChatImageItem>();
  highlight = input(false);
  open = output<HTMLElement>();
  broken = output<string>();

  failed = signal(false);
  // Natural width once loaded (the template adds 2px for the border), so small images such as
  // icons aren't stretched to the column width
  naturalWidth = signal<number | null>(null);

  onLoad(event: Event) {
    this.naturalWidth.set((event.target as HTMLImageElement).naturalWidth || null);
  }

  onError() {
    this.failed.set(true);
    this.broken.emit(this.item().url);
  }
}
