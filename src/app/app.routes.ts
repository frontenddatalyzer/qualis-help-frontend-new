import { Routes } from '@angular/router';
import { Landing } from './components/landing/landing';
import { Spc } from './components/products/spc/spc';

export const routes: Routes = [
    {path: '', component: Landing},
    {path: 'products/spc/:docId', component: Spc}
];
