import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, Input} from '@angular/core';
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

export class Hierarchy implements AfterViewInit  {
  @Input() data: any[] = [];
  selectedId?: any;

  constructor(
    private activatedRoute: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.activatedRoute.paramMap.subscribe(params => {
      const docId = params.get('docId');
      this.selectedId = docId ? Number(docId) : null;
    });
  }

  ngAfterViewInit(): void {
    setTimeout(() => {      
      // expand the first folder if available
      // if (this.selectedId && this.data?.length) {
      //   const first = this.data[0];
      //   if (this.isFolder(first)) {
      //     first.expanded = true;
      //   }
      // }

      if (this.selectedId) {
        this.expandToDoc(this.data, this.selectedId);
      }
  
      if(this.selectedId === null) {
        this.expandAll(this.data);
      }
    }, 1000);
  }

  private expandAll(nodes: any[]): void {
    if (!nodes || !nodes.length) return;

    for (const node of nodes) {
      if (this.isFolder(node)) {
        node.expanded = true;
        this.expandAll(node.children); // recurse into children
      }
    }
  }

  private expandToDoc(nodes: any[], docId: number): boolean {
    if (!nodes) return false;

    for (const node of nodes) {
      if (this.isDocument(node) && node.id === docId) {
        return true; // found the document
      }

      if (this.isFolder(node)) {
        const found = this.expandToDoc(node.children, docId);
        if (found) {
          node.expanded = true; // expand this folder because it contains the doc
          return true;
        }
      }
    }

    return false; // not found here
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
