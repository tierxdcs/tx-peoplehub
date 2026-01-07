import { Component, HostListener } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

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

  constructor(private readonly router: Router) {}

  ngOnInit() {
    this.loadNotifications();
    window.addEventListener('storage', () => this.loadNotifications());
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.showChrome = !event.urlAfterRedirects.startsWith('/login');
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
    const taskRaw = localStorage.getItem('tx-peoplehub-tasks');
    const trainingRaw = localStorage.getItem('tx-peoplehub-assigned-training');
    const tasks = taskRaw ? (JSON.parse(taskRaw) as { title: string; owner: string }[]) : [];
    const trainings = trainingRaw
      ? (JSON.parse(trainingRaw) as { title: string; department: string }[])
      : [];

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
  }
}
