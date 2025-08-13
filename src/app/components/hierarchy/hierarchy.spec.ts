import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Hierarchy } from './hierarchy';

describe('Hierarchy', () => {
  let component: Hierarchy;
  let fixture: ComponentFixture<Hierarchy>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Hierarchy]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Hierarchy);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
