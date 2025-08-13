import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { CommonHelp } from '../../common-help/common-help';

@Component({
  selector: 'app-spc',
  imports: [
    CommonModule,
    CommonHelp
  ],
  templateUrl: './spc.html',
  styleUrl: './spc.scss'
})
export class Spc {

}
