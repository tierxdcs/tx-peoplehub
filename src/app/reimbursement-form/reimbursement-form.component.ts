import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
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
  employeeName = 'Current user';

  constructor(private readonly api: ApiService) {}

  async ngOnInit() {
    try {
      const profile = await firstValueFrom(this.api.getEmployeeProfile());
      if (profile?.fullName) {
        this.employeeName = profile.fullName;
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
      employee: this.employeeName
    };
    firstValueFrom(this.api.createReimbursement(newClaim))
      .then(() => {
        this.statusMessage = 'Reimbursement submitted for approval.';
        this.form = { title: '', amount: '', category: 'Travel', date: '', notes: '' };
      })
      .catch(() => {
        this.statusMessage = 'Unable to submit reimbursement.';
      });
  }
}
