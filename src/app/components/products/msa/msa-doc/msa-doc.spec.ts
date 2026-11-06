import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MsaDoc } from './msa-doc';

describe('MsaDoc', () => {
  let component: MsaDoc;
  let fixture: ComponentFixture<MsaDoc>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MsaDoc]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MsaDoc);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
