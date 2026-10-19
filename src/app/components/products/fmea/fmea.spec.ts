import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Fmea } from './fmea';

describe('Fmea', () => {
  let component: Fmea;
  let fixture: ComponentFixture<Fmea>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Fmea]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Fmea);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
