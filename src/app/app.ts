import { Component } from '@angular/core';
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

  constructor(private readonly router: Router) {}

  ngOnInit() {
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.showChrome = !event.urlAfterRedirects.startsWith('/login');
      }
    });
  }

  toggleNotifications() {
    this.notificationsOpen = !this.notificationsOpen;
  }

  logout() {
    this.notificationsOpen = false;
    this.router.navigateByUrl('/login');
  }
}
