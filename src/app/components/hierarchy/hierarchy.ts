import { CommonModule } from '@angular/common';
import { Component, Input} from '@angular/core';
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

export class Hierarchy  {
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

  isFolder(item: any): boolean {
    return item.type === 'folder' && item.children && item.children.length > 0;
  }

  isDocument(item: any): boolean {
    return item.type === 'document';
  }
}
