import { Component, HostListener, OnDestroy } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { LoadingService } from './services/loading.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnDestroy {
  notificationsOpen = false;
  showChrome = true;
  avatarOpen = false;
  isLoading = false;
  private readonly destroy$ = new Subject<void>();
  session = {
    name: 'Alex Taylor',
    role: 'HR Operations',
    email: 'hr@tierx.com',
    director: 'No',
    department: 'Operations'
  };

  constructor(private readonly router: Router, private readonly loading: LoadingService) {}

  ngOnInit() {
    this.loadSession();
    this.loading.isLoading$.pipe(takeUntil(this.destroy$)).subscribe((state) => {
      this.isLoading = state;
    });
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.showChrome = !event.urlAfterRedirects.startsWith('/login');
        this.loadSession();
      }
    });
  }

  logout() {
    this.notificationsOpen = false;
    this.avatarOpen = false;
    localStorage.removeItem('tx-peoplehub-session');
    this.router.navigateByUrl('/login');
  }

  toggleAvatarMenu() {
    this.avatarOpen = !this.avatarOpen;
    if (this.avatarOpen) {
      this.notificationsOpen = false;
    }
  }

  @HostListener('document:click', ['$event'])
  handleDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }
    const actions = target.closest('.actions');
    if (!actions) {
      this.notificationsOpen = false;
      this.avatarOpen = false;
    }
  }

  loadSession() {
    const raw = localStorage.getItem('tx-peoplehub-session');
    if (!raw) {
      return;
    }
    try {
      const parsed = JSON.parse(raw) as {
        name?: string;
        role?: string;
        email?: string;
        director?: string;
        department?: string;
      };
      this.session = {
        name: parsed.name?.trim() || this.session.name,
        role: parsed.role?.trim() || this.session.role,
        email: parsed.email?.trim() || this.session.email,
        director: parsed.director?.trim() || this.session.director,
        department: parsed.department?.trim() || this.session.department
      };
    } catch {
      // Keep defaults if session data is malformed.
    }
  }

  get avatarInitials() {
    const tokens = this.session.name.split(' ').filter(Boolean);
    if (!tokens.length) {
      return 'TX';
    }
    const initials = tokens
      .slice(0, 2)
      .map((token) => token[0]?.toUpperCase() ?? '')
      .join('');
    return initials || 'TX';
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
