import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-reimbursement-form',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './reimbursement-form.component.html',
  styleUrl: './reimbursement-form.component.scss'
})
export class ReimbursementFormComponent {
  private readonly storageKey = 'tx-peoplehub-reimbursements';
  form = {
    title: '',
    amount: '',
    category: 'Travel',
    date: '',
    notes: ''
  };
  statusMessage = '';

  submit() {
    if (!this.form.title || !this.form.amount || !this.form.date) {
      this.statusMessage = 'Please complete title, amount, and date.';
      return;
    }

    const numericAmount = this.form.amount.toString().replace(/[^\d.]/g, '');
    const formattedAmount = `₹${numericAmount}`;
    const submitted = new Date(this.form.date).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric'
    });
    const newClaim = {
      title: this.form.title,
      amount: formattedAmount,
      status: 'Pending',
      submitted
    };
    const stored = localStorage.getItem(this.storageKey);
    const existing = stored ? (JSON.parse(stored) as typeof newClaim[]) : [];
    localStorage.setItem(
      this.storageKey,
      JSON.stringify([newClaim, ...existing])
    );

    this.statusMessage = 'Reimbursement submitted for approval.';
    this.form = { title: '', amount: '', category: 'Travel', date: '', notes: '' };
  }
}
