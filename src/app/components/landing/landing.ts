import { Component } from '@angular/core';
import { Products } from '../../utils/products.enum';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { LandingService } from '../../services/landing.service';
import { marked } from 'marked';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Component({
  selector: 'app-landing',
  imports: [
    CommonModule,
    FormsModule,
    RouterModule
  ],
  templateUrl: './landing.html',
  styleUrl: './landing.scss'
})
export class Landing {
  products = Object.values(Products);  // Convert enum to array
  // selectedProduct: string = this.products[0];
  search: string = '';
  firstThreeDocs: any;
  loading = false;
  error: string | null = null;
  firstDocID: any;

  allDocs: any[] = [];
  searchResults: any[] = [];

  constructor(
    private landingService: LandingService,
    private router: Router,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit() {
    this.loadAllDocs();
  }

  loadAllDocs() {
    this.loading = true;
    this.error = null;

    this.landingService.getDocumentationNodes().subscribe({
      next: (response: any) => {
        const treeData = response?.data ?? [];
        
        // Keep only items where showTree === true
        const filteredTreeData = response.data[0].children.filter((item: any) => item.showTree);

        // Flatten all document nodes into a list
        this.allDocs = this.flattenDocs(filteredTreeData);

        // Store first 3 docs for home display
        this.firstThreeDocs = this.allDocs.slice(0, 3);

        // Store first document ID for gotoHelp()
        this.firstDocID = this.allDocs[0]?.id;

        this.loading = false;
      },
      error: (err) => {
        this.error = 'Failed to load documents. Please try again later.';
        this.loading = false;
        console.error(err);
      }
    });
  }

  flattenDocs(nodes: any[], result: any[] = [], seenIds = new Set()): any[] {
    for (const node of nodes) {
      if (node.type === 'document' && !seenIds.has(node.id)) {
        seenIds.add(node.id);
        result.push(node);
      }
      if (node.children?.length) {
        this.flattenDocs(node.children, result, seenIds);
      }
    }
    return result;
  }

  // 🔹 Convert Markdown string to HTML for preview
  async markdownToHtml(md: string): Promise<SafeHtml> {
    const html = await marked(md || '');
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  async onSearch() {
    const q = this.search.trim().toLowerCase();
    if (!q) {
      this.searchResults = [];
      return;
    }

    // Find docs with matches
    const results = this.allDocs
      .map(doc => {
        const contentLower = (doc.content || '').toLowerCase();
        const index = contentLower.indexOf(q);

        if (index === -1) return null; // no match

        const snippetStart = Math.max(0, index - 50);
        const snippetEnd = Math.min(doc.content.length, index + q.length + 50);
        let snippet = doc.content.substring(snippetStart, snippetEnd);

        // Highlight search term (case-insensitive)
        const regex = new RegExp(`(${q})`, 'ig');
        snippet = snippet.replace(regex, '<mark>$1</mark>');

        return { ...doc, snippet };
      })
      .filter(Boolean);

    // Convert each snippet to HTML (Markdown → HTML)
    for (let doc of results) {
      doc.snippet = await this.markdownToHtml(doc.snippet);
    }

    this.searchResults = results;
  }

  gotoHelp() {
    this.router.navigate(['products/spc']);
  }
}
