import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { Hierarchy } from '../../hierarchy/hierarchy';
import { environment } from '../../../../environments/environments';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-spc',
  imports: [
    CommonModule,
    RouterModule,
    Hierarchy
  ],
  templateUrl: './spc.html',
  styleUrl: './spc.scss'
})
export class Spc {
  treeData: any[] = [];
  private spcEndPoint = `${environment.apiUrl}/spc-nodes`;
  urlCopied: boolean = false;

  constructor(
    private http: HttpClient,
  ) {}

  ngOnInit() {
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
