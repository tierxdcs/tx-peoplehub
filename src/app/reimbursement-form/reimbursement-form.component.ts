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
    this.statusMessage = 'Reimbursement submitted for approval.';
    this.form = { title: '', amount: '', category: 'Travel', date: '', notes: '' };
  }
}
