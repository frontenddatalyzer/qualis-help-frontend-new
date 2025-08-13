import { Injectable } from '@angular/core';
import { environment } from '../../environments/environments';
import { HttpClient } from '@angular/common/http';
import { catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class LandingService {
  private spcEndPoint = `${environment.apiUrl}/spc-nodes`;

  constructor(
    private http: HttpClient
  ) {}

  getDocumentationNodes() {
    return this.http.get<any[]>(this.spcEndPoint).pipe(
      catchError(error => {
        console.error('API Error:', error);
        return throwError(() => new Error('Failed to fetch documentation'));
      })
    );
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
