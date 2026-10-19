import { CommonModule, Location, isPlatformBrowser } from '@angular/common';
import { Component, HostListener, NgZone, OnInit, OnDestroy, Inject, PLATFORM_ID } from '@angular/core';
import { Hierarchy } from '../hierarchy/hierarchy';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Subscription } from 'rxjs';
import { marked } from 'marked';
import createDOMPurify from 'dompurify';
import { LandingService } from '../../services/landing.service';
import { Products } from '../../utils/products.enum';

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
export class CommonHelp implements OnInit, OnDestroy {
  treeData: any[] = [];
  documentContent: string = '';
  documentContentHtml?: SafeHtml;
  activeScroll: boolean = false;
  tocNav: any[] = [];

  searchTerm = '';
  currentDocId: number | null = null;
  currentDocTxt = '';
  urlCopied: boolean = false;

  product?: Products;
  productSlug = '';

  private allNodes: any[] = [];           // cached Strapi response for the current product
  private loadedSlug: string | null = null;
  private dataSub?: Subscription;

  constructor(
    private landingService: LandingService,
    private activatedRoute: ActivatedRoute,
    private router: Router,
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

    // 1) Watch query params (search term for highlighting)
    this.activatedRoute.queryParams.subscribe(params => {
      const prevQ = this.searchTerm;
      this.searchTerm = params['q'] || '';
      if (this.currentDocId && prevQ !== this.searchTerm && this.documentContent) {
        this.renderDocumentWithHighlight();
      }
    });

    // 2) Watch route params (product + docId)
    this.activatedRoute.paramMap.subscribe(params => {
      // Product: route data → :product param → URL segment after 'products'
      const segments = this.activatedRoute.snapshot.pathFromRoot
        .flatMap(r => r.url.map(s => s.path));          // e.g. ['products', 'fmea', '5']
      const urlSlug = segments[segments.indexOf('products') + 1];
      
      // Product comes from route data (products/spc, products/fmea),
      // or from a :product param if the routes are made generic later
      const slug = this.activatedRoute.snapshot.data['product']
        ?? params.get('product')
        ?? urlSlug;

      const product = this.landingService.getProductBySlug(slug);

      if (!product) {
        console.warn('Unknown product slug:', slug);
        this.router.navigate(['/']);
        return;
      }

      const docId = Number(params.get('docId')) || null;
      this.product = product;
      this.productSlug = slug;

      if (slug !== this.loadedSlug) {
        this.loadProductData(product, slug, docId);  // product changed → fetch once
      } else {
        this.showDocument(docId);                     // same product → use cached data
      }
    });
  }

  ngOnDestroy() {
    this.dataSub?.unsubscribe();
  }

  private loadProductData(product: Products, slug: string, docId: number | null) {
    this.dataSub?.unsubscribe(); // drop a pending request if the user switches quickly
    this.treeData = [];
    this.allNodes = [];
    this.clearDocument();

    this.dataSub = this.landingService.getDocumentationNodes(product).subscribe({
      next: (res) => {
        this.allNodes = res?.data ?? [];

        // Left nav: keep only items where showTree === true
        const children = this.allNodes[0]?.children ?? [];
        this.treeData = children.filter((item: any) => item.showTree);

        this.loadedSlug = slug;
        this.showDocument(docId);
      },
      error: (err) => {
        console.error(`Error fetching ${product} data:`, err);
        this.documentContent = '<p>Error loading document.</p>';
        this.renderMarkdownToHtml(this.documentContent);
      }
    });
  }

  private showDocument(docId: number | null) {
    this.currentDocId = docId;

    if (!docId) {
      this.clearDocument();
      return;
    }

    const foundDoc = this.findDocumentById(this.allNodes, docId);

    if (foundDoc) {
      this.tocNav = foundDoc.navigation ?? [];
      this.documentContent = foundDoc.content || '';
      this.currentDocTxt = foundDoc.text;
    } else {
      this.tocNav = [];
      this.currentDocTxt = '';
      this.documentContent = '<p>Document not found.</p>';
    }

    // Render (with highlight if searchTerm present)
    this.renderDocumentWithHighlight();

    // After DOM insertion, update anchors and scroll to first match
    setTimeout(() => {
      this.updateAnchorHrefFromMarkdownHtml();
      this.scrollToFirstMatch();
    }, 250);
  }

  private clearDocument() {
    this.documentContent = '';
    this.documentContentHtml = undefined;
    this.tocNav = [];
    this.currentDocTxt = '';
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

    // const backendUrl = 'https://helpbackend.qualis40.io';
    const backendUrl = 'http://localhost:1337';
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

    renderer.image = ({ href, title, text }) => {
      if (href?.startsWith('http://localhost:1337')) {
        href = href.replace('http://localhost:1337', backendUrl);
      }
      return `<img src="${href}" alt="${text || ''}" ${title ? `title="${title}"` : ''} />`;
    };

    // Markdown → raw HTML
    let rawHtml = marked(markdown, { renderer }) as string;

    // Replace Strapi localhost URLs with public backend URL
    rawHtml = rawHtml.replace(/http:\/\/localhost:1337/g, backendUrl);

    // Allow <mark> so search highlights are preserved
    const clean = DOMPurifyInstance
      ? DOMPurifyInstance.sanitize(rawHtml, { ADD_TAGS: ['mark'] })
      : rawHtml;

    this.documentContentHtml = this.sanitizer.bypassSecurityTrustHtml(clean);
  }

  // Render this.documentContent while wrapping searchTerm in <mark>
  private renderDocumentWithHighlight() {
    let mdToRender = this.documentContent || '';

    if (this.searchTerm) {
      const rx = new RegExp(this.escapeRegex(this.searchTerm), 'ig');
      mdToRender = mdToRender.replace(rx, '<mark>$&</mark>');
    }

    this.renderMarkdownToHtml(mdToRender);
  }

  private updateAnchorHrefFromMarkdownHtml() {
    if (!isPlatformBrowser(this.platformId)) {
      return; // no DOM on server
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

    const container = document.querySelector('.document-viewer');
    if (!container) return;

    const firstMark = container.querySelector('mark');
    if (firstMark) {
      (firstMark as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });

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
      this.activeScroll = window.scrollY > 51;
    });
  }

  private escapeRegex(text: string) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  copyUrl() {
    const url = window.location.href;

    navigator.clipboard.writeText(url).then(() => {
      this.urlCopied = true;
      setTimeout(() => this.urlCopied = false, 2000);
    }).catch(err => {
      console.error('Failed to copy:', err);
    });
  }
}