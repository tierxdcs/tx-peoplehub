import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../services/api.service';

@Component({
  selector: 'app-reimbursement-form',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './reimbursement-form.component.html',
  styleUrl: './reimbursement-form.component.scss'
})
export class ReimbursementFormComponent {
  form = {
    title: '',
    amount: '',
    category: 'Travel',
    date: '',
    notes: ''
  };
  statusMessage = '';
  toastMessage = '';
  employeeName = 'Current user';
  employeeEmail = '';

  constructor(
    private readonly api: ApiService,
    private readonly router: Router
  ) {}

  async ngOnInit() {
    try {
      const rawSession = localStorage.getItem('tx-peoplehub-session');
      if (rawSession) {
        try {
          const parsed = JSON.parse(rawSession) as { name?: string; email?: string };
          this.employeeName = parsed.name?.trim() || this.employeeName;
          this.employeeEmail = parsed.email?.trim().toLowerCase() || '';
        } catch {
          this.employeeEmail = '';
        }
      }
      const profile = await firstValueFrom(this.api.getEmployeeProfile());
      if (profile?.fullName) {
        this.employeeName = profile.fullName;
      }
      if (profile?.email) {
        this.employeeEmail = profile.email;
      }
    } catch {
      return;
    }
  }

  submit() {
    if (!this.form.title || !this.form.amount || !this.form.date) {
      this.statusMessage = 'Please complete title, amount, and date.';
      return;
    }

    const numericAmount = this.form.amount.toString().replace(/[^\d.]/g, '');
    const formattedAmount = `₹${numericAmount}`;
    const newClaim = {
      title: this.form.title,
      amount: formattedAmount,
      category: this.form.category,
      date: this.form.date,
      notes: this.form.notes,
      status: 'Pending',
      employee: this.employeeName,
      employeeEmail: this.employeeEmail
    };
    firstValueFrom(this.api.createReimbursement(newClaim))
      .then(() => {
        this.statusMessage = '';
        this.toastMessage = 'Reimbursement submitted successfully.';
        this.form = { title: '', amount: '', category: 'Travel', date: '', notes: '' };
        window.setTimeout(() => {
          this.toastMessage = '';
          void this.router.navigate(['/reimbursement']);
        }, 900);
      })
      .catch(() => {
        this.statusMessage = 'Unable to submit reimbursement.';
      });
  }
}
