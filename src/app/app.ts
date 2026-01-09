import { Component, HostListener } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiService } from './services/api.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  notificationsOpen = false;
  showChrome = true;
  avatarOpen = false;
  notifications: { message: string; category: string }[] = [];
  session = {
    name: 'Alex Taylor',
    role: 'HR Operations',
    email: 'hr@tierx.com',
    director: 'No'
  };

  constructor(private readonly router: Router, private readonly api: ApiService) {}

  ngOnInit() {
    this.loadSession();
    this.loadNotifications();
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.showChrome = !event.urlAfterRedirects.startsWith('/login');
        this.loadSession();
        this.loadNotifications();
      }
    });
  }

  toggleNotifications() {
    this.notificationsOpen = !this.notificationsOpen;
    if (this.notificationsOpen) {
      this.avatarOpen = false;
    }
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

  loadNotifications() {
    forkJoin([
      this.api.getTasks({
        ownerEmail: this.session.email?.trim().toLowerCase() || undefined,
        ownerName: this.session.name
      }),
      this.api.getTrainingAssignments()
    ]).subscribe({
      next: ([tasks, trainings]) => {
        this.notifications = [
          ...tasks.map((task) => ({
            message: `Task assigned: ${task.title}`,
            category: 'Tasks'
          })),
          ...trainings.map((training) => ({
            message: `Training assigned: ${training.title}`,
            category: 'Training'
          }))
        ].slice(0, 6);
      },
      error: () => {
        this.notifications = [];
      }
    });
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
      };
      this.session = {
        name: parsed.name?.trim() || this.session.name,
        role: parsed.role?.trim() || this.session.role,
        email: parsed.email?.trim() || this.session.email,
        director: parsed.director?.trim() || this.session.director
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
}
