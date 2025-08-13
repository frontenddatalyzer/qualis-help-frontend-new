import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Header } from './components/header/header';
import { Footer } from './components/footer/footer';
import { ViewportScroller } from '@angular/common';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    Header,
    Footer
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  private viewport = inject(ViewportScroller);

  constructor() {
    // Set a fixed scroll offset, e.g., for a sticky header
    this.viewport.setOffset([0, 90]); // Offset X=0, Y=64px
  }

}
