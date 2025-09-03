import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { CommonHelp } from '../../../common-help/common-help';

@Component({
  selector: 'app-spc-doc',
  imports: [
    CommonModule,
    CommonHelp
  ],
  templateUrl: './spc-doc.html',
  styleUrl: './spc-doc.scss'
})
export class SpcDoc {

}
