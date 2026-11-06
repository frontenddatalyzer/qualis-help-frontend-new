import { Injectable } from '@angular/core';
import { environment } from '../../environments/environments';
import { HttpClient } from '@angular/common/http';
import { catchError, map, tap } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { Products } from '../utils/products.enum';

@Injectable({
  providedIn: 'root'
})
export class LandingService {
  // private spcEndPoint = `${environment.apiUrl}/spc-nodes`;
  // private fmeaEndPoint = `${environment.apiUrl}/fmea-nodes`;
  private endpoints: Record<Products, string> = {
    [Products.spc]: `${environment.apiUrl}/spc-nodes`,
    [Products.fmea]: `${environment.apiUrl}/fmea-nodes`,
    [Products.msa]: `${environment.apiUrl}/msa-nodes`,
  };

  private slugs: Record<Products, string> = {
    [Products.spc]: 'spc',
    [Products.fmea]: 'fmea',
    [Products.msa]: 'msa',
  };

  constructor(
    private http: HttpClient
  ) {}

  getDocumentationNodes(product: Products) {
    const url = this.endpoints[product];

    if (!url) {
      return throwError(() => new Error(`Unknown product: ${product}`));
    }

    return this.http.get<any>(url).pipe(
      catchError(error => {
        console.error('API Error:', error);
        return throwError(() => new Error('Failed to fetch documentation'));
      })
    );
  }

  getSlug(product: Products): string {
    return this.slugs[product];
  }

  getProductBySlug(slug: string | null): Products | undefined {
    return (Object.keys(this.slugs) as Products[]).find(p => this.slugs[p] === slug);
  }
  
  findFirstNDocuments(
    nodes: Array<{
      type: string;
      children?: any[];
      [key: string]: any;
    }>,
    count: number = 3,
    results: Array<Record<string, any>> = []
  ): Array<Record<string, any>> {
    for (const node of nodes) {
      if (results.length >= count) break;
      
      if (node.type === "document") {
        results.push(node);
        if (results.length >= count) break;
      }
      
      if (node.children?.length) {
        this.findFirstNDocuments(node.children, count, results);
      }
    }
    return results.slice(0, count);
  }
}
