import { Routes } from '@angular/router';
import { Landing } from './components/landing/landing';
import { Spc } from './components/products/spc/spc';
import { SpcDoc } from './components/products/spc/spc-doc/spc-doc';
import { Fmea } from './components/products/fmea/fmea';
import { FmeaDoc } from './components/products/fmea/fmea-doc/fmea-doc';
import { Msa } from './components/products/msa/msa';
import { MsaDoc } from './components/products/msa/msa-doc/msa-doc';

export const routes: Routes = [
    {path: '', component: Landing},
    {path: 'products/spc', component: Spc},
    {path: 'products/spc/:docId', component: SpcDoc},
    {path: 'products/fmea', component: Fmea},
    {path: 'products/fmea/:docId', component: FmeaDoc},
    {path: 'products/msa', component: Msa},
    {path: 'products/msa/:docId', component: MsaDoc},
];
