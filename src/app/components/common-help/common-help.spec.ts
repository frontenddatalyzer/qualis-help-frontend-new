import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CommonHelp } from './common-help';

describe('CommonHelp', () => {
  let component: CommonHelp;
  let fixture: ComponentFixture<CommonHelp>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommonHelp]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CommonHelp);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
