import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SpcDoc } from './spc-doc';

describe('SpcDoc', () => {
  let component: SpcDoc;
  let fixture: ComponentFixture<SpcDoc>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SpcDoc]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SpcDoc);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
