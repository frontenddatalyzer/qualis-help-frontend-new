import { Component, computed, input, output, signal } from '@angular/core';
import { ChatImageItem, OpenImageEvent } from '../chat-images';

// Wrapping grid of screenshot thumbnails; broken images are dropped silently
@Component({
  selector: 'app-chat-thumbnails',
  templateUrl: './chat-thumbnails.html',
  styleUrl: './chat-thumbnails.scss'
})
export class ChatThumbnails {
  items = input.required<ChatImageItem[]>();
  // source index to emphasise (e.g. while hovering its [n] marker)
  highlight = input<number | null>(null);
  open = output<OpenImageEvent>();

  private broken = signal<ReadonlySet<string>>(new Set());
  visible = computed(() => this.items().filter(item => !this.broken().has(item.url)));

  markBroken(url: string) {
    this.broken.update(set => new Set(set).add(url));
  }

  onOpen(index: number, event: Event) {
    this.open.emit({ items: this.visible(), index, trigger: event.currentTarget as HTMLElement });
  }
}
