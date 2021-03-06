import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { PrizeService } from '../prize/prize.service';

@Injectable({
  providedIn: 'root',
})
export class CashBalanceService {
  private totalCash$$ = new BehaviorSubject<number>(10);

  public totalCash$ = this.totalCash$$.asObservable();

  constructor(private prizes: PrizeService) {
    this.prizes.prize$.pipe().subscribe((i) => {
      if (i) {
        const pot = i?.reduce((a, b) => a + b.amount, 0);
        this.cash = this.totalCash$$.value + pot;
      }
    });
  }

  public get isBroke$(): Observable<boolean> {
    return this.totalCash$.pipe(map((v) => v <= 0));
  }

  public set cash(c: number) {
    this.totalCash$$.next(c);
  }

  public decreaseCash(amount = 1): void {
    this.totalCash$$.next(this.totalCash$$.value - amount);
  }
}
