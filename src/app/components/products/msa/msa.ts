import { Component } from '@angular/core';
import { environment } from '../../../../environments/environments';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Hierarchy } from '../../hierarchy/hierarchy';

@Component({
  selector: 'app-msa',
  imports: [
    CommonModule,
    RouterModule,
    Hierarchy
  ],
  templateUrl: './msa.html',
  styleUrl: './msa.scss'
})
export class Msa {
  treeData: any[] = [];
  private msaEndPoint = `${environment.apiUrl}/msa-nodes`;
  urlCopied: boolean = false;

  constructor(
    private http: HttpClient,
  ) {}

  ngOnInit() {
    this.http.get<any>(this.msaEndPoint)
      .subscribe({
        next: (res) => {
          const treeData = res?.data?.[0]?.children ?? [];
          
          // Keep only items where showTree === true
          const filteredTreeData = treeData.filter((item: any) => item.showTree);
          this.treeData = filteredTreeData;
        },
        error: (err) => {
          console.error('Error fetching MSA data:', err);
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
