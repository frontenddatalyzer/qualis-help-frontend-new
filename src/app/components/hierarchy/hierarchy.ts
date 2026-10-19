import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import { ActivatedRoute, RouterModule } from '@angular/router';

@Component({
  selector: 'app-hierarchy',
  imports: [
    CommonModule,
    RouterModule
  ],
  templateUrl: './hierarchy.html',
  styleUrl: './hierarchy.scss'
})
export class Hierarchy implements OnInit, OnChanges {
  @Input() data: any[] = [];
  @Input() productSlug = '';   // 'spc' | 'fmea' — passed from common-help
  selectedId: number | null = null;

  constructor(private activatedRoute: ActivatedRoute) {}

  ngOnInit(): void {
    if (!this.productSlug) {
      const segments = this.activatedRoute.snapshot.pathFromRoot
        .flatMap(r => r.url.map(s => s.path));
      this.productSlug = this.activatedRoute.snapshot.data['product']
        ?? segments[segments.indexOf('products') + 1]
        ?? '';
    }

    this.activatedRoute.paramMap.subscribe(params => {
      const docId = params.get('docId');
      this.selectedId = docId ? Number(docId) : null;
      this.applyExpansion();
    });
  }

  // Runs whenever new tree data arrives (first load, or product switch)
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['data']) {
      this.applyExpansion();
    }
  }

  private applyExpansion(): void {
    if (!this.data?.length) return;

    if (this.selectedId) {
      this.expandToDoc(this.data, this.selectedId);
    } else {
      this.expandAll(this.data);
    }
  }

  private expandAll(nodes: any[]): void {
    if (!nodes?.length) return;

    for (const node of nodes) {
      if (this.isFolder(node)) {
        node.expanded = true;
        this.expandAll(node.children);
      }
    }
  }

  private expandToDoc(nodes: any[], docId: number): boolean {
    if (!nodes) return false;

    for (const node of nodes) {
      if (this.isDocument(node) && node.id === docId) {
        return true;
      }

      if (this.isFolder(node)) {
        const found = this.expandToDoc(node.children, docId);
        if (found) {
          node.expanded = true; // folder contains the selected doc
          return true;
        }
      }
    }

    return false;
  }

  isFolder(item: any): boolean {
    return item.type === 'folder' && item.children && item.children.length > 0;
  }

  isDocument(item: any): boolean {
    return item.type === 'document';
  }

  toggleFolder(node: any) {
    if (typeof node === 'object') {
      node.expanded = !node.expanded;
    }
  }
}