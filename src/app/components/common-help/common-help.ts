import { CommonModule, Location } from '@angular/common';
import { AfterViewInit, Component, HostListener, NgZone, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Hierarchy } from '../hierarchy/hierarchy';
import { environment } from '../../../environments/environments';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';
import createDOMPurify from 'dompurify';

let DOMPurifyInstance: ReturnType<typeof createDOMPurify> | null = null;

@Component({
  selector: 'app-common-help',
  imports: [
    CommonModule,
    RouterModule,
    Hierarchy
  ],
  templateUrl: './common-help.html',
  styleUrl: './common-help.scss'
})
export class CommonHelp implements OnInit, AfterViewInit {
  treeData: any[] = [];
  private spcEndPoint = `${environment.apiUrl}/spc-nodes`;
  documentContent: string = '';
  documentContentHtml?: SafeHtml;
  activeScroll: boolean = false;
  tocNav: any[] = [];

  searchTerm = '';
  currentDocId: number | null = null;

  constructor(
    private http: HttpClient,
    private activatedRoute: ActivatedRoute,
    private sanitizer: DomSanitizer,
    private ngZone: NgZone,
    private location: Location
  ) {}

  ngOnInit() {
    // init DOMPurify (browser only)
    if (typeof window !== 'undefined') {
      DOMPurifyInstance = createDOMPurify(window as any);
    }

    // 1) Watch query params first (so searchTerm gets set as early as possible)
    this.activatedRoute.queryParams.subscribe(params => {
      const newQ = params['q'] || '';
      // If query changed and doc already loaded, re-render to add highlights
      const prevQ = this.searchTerm;
      this.searchTerm = newQ;
      if (this.currentDocId && prevQ !== this.searchTerm && this.documentContent) {
        // re-render current markdown with the updated search term
        this.renderDocumentWithHighlight();
      }
    });

    // 2) Fetch tree for left nav (unchanged)
    this.http.get<any>(this.spcEndPoint)
      .subscribe({
        next: (res) => {
          const treeData = res?.data?.[0]?.children ?? [];
          this.treeData = treeData;
        },
        error: (err) => {
          console.error('Error fetching SPC data:', err);
        }
      });

    // 3) Watch route param for docId
    this.activatedRoute.paramMap.subscribe(params => {
      const docIdParam = params.get('docId');
      const docId = Number(docIdParam);
      if (docId) {
        this.currentDocId = docId;
        this.loadDocumentContent(docId);
      }
    });
  }

  ngAfterViewInit() {
    // no-op: scroll is handled after render in loadDocumentContent / renderDocumentWithHighlight
  }

  private findDocumentById(nodes: any[], id: number): any | null {
    for (const node of nodes) {
      if (node.id === id) {
        return node;
      }
      if (node.children && node.children.length > 0) {
        const found = this.findDocumentById(node.children, id);
        if (found) {
          return found;
        }
      }
    }
    return null;
  }

  getTokenText(tokens: any[]): string {
    return tokens
      .map(token => (token.type === 'text' ? token.text : (token.raw || '')))
      .join('');
  }

  private renderMarkdownToHtml(markdown: string) {
    if (!markdown?.trim()) {
      this.documentContentHtml = 'No Content';
      return;
    }

    const renderer = new marked.Renderer();

    renderer.heading = ({ tokens, depth }) => {
      let text = this.getTokenText(tokens);
      const match = text.match(/\s*\{#([a-zA-Z0-9\-_]+)\}\s*$/);
      let id = '';

      if (match) {
        id = match[1];
        text = text.replace(match[0], '');
      } else {
        id = text
          .toLowerCase()
          .replace(/[^\w]+/g, '-')
          .replace(/^-|-$/g, '');
      }

      return `<h${depth} id="${id}">${text}</h${depth}>`;
    };

    // Synchronous conversion (we call marked synchronously here)
    const rawHtml = marked(markdown, { renderer }) as string;

    // Allow <mark> tag so highlights are preserved
    const clean = DOMPurifyInstance
      ? DOMPurifyInstance.sanitize(rawHtml, { ADD_TAGS: ['mark'] })
      : rawHtml;

    this.documentContentHtml = this.sanitizer.bypassSecurityTrustHtml(clean);
  }

  private async loadDocumentContent(docId: number) {
    this.documentContent = '';
    this.http.get<any>(`${this.spcEndPoint}`).subscribe({
      next: (res) => {
        const data = res?.data;
        const foundDoc = this.findDocumentById(data, docId);

        if (foundDoc) {
          this.tocNav = foundDoc?.navigation;
          this.documentContent = foundDoc?.content || '';
        } else {
          this.documentContent = '<p>Document not found.</p>';
        }

        // Render (with highlight if searchTerm present)
        this.renderDocumentWithHighlight();

        // After a short delay to ensure DOM insertion, update anchors and scroll
        setTimeout(() => {
          this.updateAnchorHrefFromMarkdownHtml();
          this.scrollToFirstMatch();
        }, 250);
      },
      error: (err) => {
        console.error('Error fetching document:', err);
        this.documentContent = '<p>Error loading document.</p>';
        this.renderMarkdownToHtml(this.documentContent);
      }
    });
  }

  // Render the existing this.documentContent while injecting <mark> around searchTerm
  private renderDocumentWithHighlight() {
    let mdToRender = this.documentContent || '';

    if (this.searchTerm) {
      const rx = new RegExp(this.escapeRegex(this.searchTerm), 'ig');
      // Wrap matches with <mark>. We do this on the markdown text before passing to marked
      mdToRender = mdToRender.replace(rx, '<mark>$&</mark>');
    }

    this.renderMarkdownToHtml(mdToRender);
  }

  private updateAnchorHrefFromMarkdownHtml() {
    const markdownContainer = document.querySelector('.document-viewer');

    if (markdownContainer) {
      const anchors = markdownContainer.querySelectorAll<HTMLAnchorElement>('a[href^="#"]');
      const baseUrl = window.location.origin + this.location.path();

      anchors.forEach(anchor => {
        const hash = anchor.getAttribute('href');
        if (hash) {
          anchor.setAttribute('href', `${baseUrl}${hash}`);
        }
      });
    }
  }

  private scrollToFirstMatch() {
    // Query inside the document-viewer container only
    const container = document.querySelector('.document-viewer');
    if (!container) return;

    const firstMark = container.querySelector('mark');
    if (firstMark) {
      // scroll the element into center of view
      (firstMark as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });

      // optional visual flash: add class then remove after timeout
      (firstMark as HTMLElement).classList.add('search-highlight-flash');
      setTimeout(() => (firstMark as HTMLElement).classList.remove('search-highlight-flash'), 1200);
    }
  }

  gotoTop() {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  @HostListener('window:scroll', [])
  onWindowScroll() {
    this.ngZone.run(() => {
      if (window.scrollY > 51) {
        this.activeScroll = true;
      } else {
        this.activeScroll = false;
      }
    });
  }

  private escapeRegex(text: string) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
