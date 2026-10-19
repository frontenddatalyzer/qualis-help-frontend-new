import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FmeaDoc } from './fmea-doc';

describe('FmeaDoc', () => {
  let component: FmeaDoc;
  let fixture: ComponentFixture<FmeaDoc>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FmeaDoc]
    })
    .compileComponents();

    fixture = TestBed.createComponent(FmeaDoc);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
