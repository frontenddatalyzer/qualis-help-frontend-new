import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Msa } from './msa';

describe('Msa', () => {
  let component: Msa;
  let fixture: ComponentFixture<Msa>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Msa]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Msa);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
