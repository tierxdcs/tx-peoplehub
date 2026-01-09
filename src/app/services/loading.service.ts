import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class LoadingService {
  private pending = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly state = new BehaviorSubject(false);
  readonly isLoading$ = this.state.asObservable();

  start() {
    this.pending += 1;
    if (this.pending === 1) {
      this.timer = setTimeout(() => {
        this.state.next(true);
        this.timer = null;
      }, 150);
    }
  }

  stop() {
    if (this.pending > 0) {
      this.pending -= 1;
    }
    if (this.pending === 0) {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      this.state.next(false);
    }
  }
}
