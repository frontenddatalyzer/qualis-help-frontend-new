import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {
    path: 'products/spc/:docId',
    renderMode: RenderMode.Server  // Render on demand at request time
  },
  {
    path: '**',
    renderMode: RenderMode.Prerender
  },
];
