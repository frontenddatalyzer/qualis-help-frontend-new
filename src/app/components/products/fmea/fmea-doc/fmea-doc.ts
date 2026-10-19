import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { CommonHelp } from '../../../common-help/common-help';

@Component({
  selector: 'app-fmea-doc',
  imports: [
    CommonModule,
    CommonHelp
  ],
  templateUrl: './fmea-doc.html',
  styleUrl: './fmea-doc.scss'
})
export class FmeaDoc {

}
