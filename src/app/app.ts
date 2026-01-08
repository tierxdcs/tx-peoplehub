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

  constructor(private readonly router: Router, private readonly api: ApiService) {}

  ngOnInit() {
    this.loadNotifications();
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.showChrome = !event.urlAfterRedirects.startsWith('/login');
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
    forkJoin([this.api.getTasks(), this.api.getTrainingAssignments()]).subscribe({
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
}
