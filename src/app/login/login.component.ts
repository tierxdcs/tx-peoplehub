import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent {
  credentials = {
    email: '',
    password: '',
    remember: true
  };
  errorMessage = '';

  constructor(private readonly router: Router) {}

  signIn() {
    const email = this.credentials.email.trim().toLowerCase();
    const password = this.credentials.password;
    const isMasterLogin = email === 'hradmin@tierxdcs.com' && password === 'Tierx@009';
    if (!isMasterLogin) {
      this.errorMessage = 'Invalid credentials. Please try again.';
      return;
    }
    this.errorMessage = '';
    localStorage.setItem(
      'tx-peoplehub-session',
      JSON.stringify({
        email: 'hradmin@tierxdcs.com',
        role: 'Admin',
        name: 'HR Admin'
      })
    );
    this.router.navigateByUrl('/');
  }
}
