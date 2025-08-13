import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Spc } from './spc';

describe('Spc', () => {
  let component: Spc;
  let fixture: ComponentFixture<Spc>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Spc]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Spc);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
