import { Component, ElementRef, HostListener, afterNextRender, computed, input, model, output, signal, viewChild } from '@angular/core';
import { ChatImageItem } from '../chat-images';

// Full-size screenshot viewer: Esc / backdrop closes, arrow keys page, focus stays inside
@Component({
  selector: 'app-chat-lightbox',
  templateUrl: './chat-lightbox.html',
  styleUrl: './chat-lightbox.scss'
})
export class ChatLightbox {
  items = input.required<ChatImageItem[]>();
  index = model.required<number>();
  closed = output<void>();

  private dialog = viewChild.required<ElementRef<HTMLElement>>('dialog');
  private closeBtn = viewChild.required<ElementRef<HTMLButtonElement>>('closeBtn');

  current = computed(() => this.items()[this.index()]);
  failedUrl = signal<string | null>(null);

  constructor() {
    afterNextRender(() => this.closeBtn().nativeElement.focus());
  }

  prev() {
    this.go(-1);
  }

  next() {
    this.go(1);
  }

  close() {
    this.closed.emit();
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent) {
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        this.close();
        break;
      case 'ArrowLeft':
        event.preventDefault();
        this.prev();
        break;
      case 'ArrowRight':
        event.preventDefault();
        this.next();
        break;
      case 'Tab':
        this.trapFocus(event);
        break;
    }
  }

  private go(step: number) {
    const count = this.items().length;
    if (count > 1) {
      this.index.set((this.index() + step + count) % count);
    }
  }

  private trapFocus(event: KeyboardEvent) {
    const focusable = Array.from(
      this.dialog().nativeElement.querySelectorAll<HTMLElement>('button, a[href]')
    );
    if (!focusable.length) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !this.dialog().nativeElement.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !this.dialog().nativeElement.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }
}
