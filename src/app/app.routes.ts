import { Routes } from '@angular/router';
import { Landing } from './components/landing/landing';
import { Spc } from './components/products/spc/spc';
import { SpcDoc } from './components/products/spc/spc-doc/spc-doc';

export const routes: Routes = [
    {path: '', component: Landing},
    {path: 'products/spc', component: Spc},
    {path: 'products/spc/:docId', component: SpcDoc}
];
