import { CommonModule, Location, isPlatformBrowser } from '@angular/common';
import { AfterViewInit, Component, HostListener, NgZone, OnInit, Inject, PLATFORM_ID } from '@angular/core';
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
  currentDocTxt!: string;
  urlCopied: boolean = false;

  constructor(
    private http: HttpClient,
    private activatedRoute: ActivatedRoute,
    private sanitizer: DomSanitizer,
    private ngZone: NgZone,
    private location: Location,
    @Inject(PLATFORM_ID) private platformId: Object,
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
          
          // Keep only items where showTree === true
          const filteredTreeData = treeData.filter((item: any) => item.showTree);
          this.treeData = filteredTreeData;
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

    const backendUrl = 'https://helpbackend.qualis40.io';
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

    // Image fix (object params, not 3 args)
    renderer.image = ({ href, title, text }) => {
      if (href?.startsWith('http://localhost:1337')) {
        href = href.replace('http://localhost:1337', backendUrl);
      }
      return `<img src="${href}" alt="${text || ''}" ${title ? `title="${title}"` : ''} />`;
    };

    // Synchronous conversion (we call marked synchronously here)
    // const rawHtml = marked(markdown, { renderer }) as string;
    // Convert markdown to raw HTML
    let rawHtml = marked(markdown, { renderer }) as string;

    // Replace Strapi localhost URLs with public backend URL
    
    rawHtml = rawHtml.replace(/http:\/\/localhost:1337/g, backendUrl);

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
          this.currentDocTxt = foundDoc?.text;
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
    if (!isPlatformBrowser(this.platformId)) {
      // Skip on server (no DOM available)
      return;
    }

    const anchors = document.querySelectorAll('a[href^="#"]');

    anchors.forEach(anchor => {
      anchor.addEventListener('click', (event) => {
        event.preventDefault();
        const id = anchor.getAttribute('href')!.substring(1);
        const target = document.getElementById(id);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth' });
        }
      });
    });
  }

  private scrollToFirstMatch() {
    if (!isPlatformBrowser(this.platformId)) {
      return; // skip in SSR
    }

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

  copyUrl() {
    const url = window.location.href;

    navigator.clipboard.writeText(url).then(() => {
      this.urlCopied = true;

      // Hide feedback after 2s
      setTimeout(() => this.urlCopied = false, 2000);
    }).catch(err => {
      console.error('Failed to copy:', err);
    });
  }
}
