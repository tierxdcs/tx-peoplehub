import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../services/api.service';

@Component({
  selector: 'app-reimbursement',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './reimbursement.component.html',
  styleUrl: './reimbursement.component.scss'
})
export class ReimbursementComponent {
  claims: { title: string; amount: string; status: string; submitted: string; notes: string }[] = [];
  employeeEmail = '';
  employeeName = '';
  statusMessage = '';
  approvedMessage = '';
  showSuccessModal = false;
  form = {
    title: '',
    amount: '',
    category: 'Travel',
    date: '',
    notes: ''
  };

  constructor(private readonly api: ApiService) {}

  async ngOnInit() {
    this.loadSession();
    await this.loadClaims();
  }

  loadSession() {
    const rawSession = localStorage.getItem('tx-peoplehub-session');
    if (!rawSession) {
      return;
    }
    try {
      const parsed = JSON.parse(rawSession) as { email?: string; name?: string };
      this.employeeEmail = parsed.email?.trim().toLowerCase() ?? '';
      this.employeeName = parsed.name?.trim() || 'Employee';
    } catch {
      this.employeeEmail = '';
    }
  }

  async loadClaims() {
    if (!this.employeeEmail) {
      this.claims = [];
      return;
    }
    try {
      const reimbursements = await firstValueFrom(
        this.api.getReimbursements({ employeeEmail: this.employeeEmail, employeeName: this.employeeName })
      );
      this.claims = reimbursements.map((claim) => ({
        title: claim.title,
        amount: claim.amount,
        status: claim.status || 'Pending',
        submitted: claim.date
          ? new Date(claim.date).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric'
            })
          : '',
        notes: claim.notes ?? ''
      }));
      this.approvedMessage = '';
    } catch {
      this.claims = [];
      this.approvedMessage = '';
    }
  }

  submit() {
    if (!this.form.title || !this.form.amount || !this.form.date) {
      this.statusMessage = 'Please complete title, amount, and date.';
      return;
    }
    if (!this.employeeEmail) {
      this.statusMessage = 'Login required to submit reimbursements.';
      return;
    }
    const numericAmount = this.form.amount.toString().replace(/[^\d.]/g, '');
    const formattedAmount = `₹${numericAmount}`;
    const payload = {
      title: this.form.title.trim(),
      amount: formattedAmount,
      category: this.form.category,
      date: this.form.date,
      notes: this.form.notes,
      status: 'Pending',
      employee: this.employeeName,
      employeeEmail: this.employeeEmail
    };
    firstValueFrom(this.api.createReimbursement(payload))
      .then((saved) => {
        this.statusMessage = 'Reimbursement submitted for approval.';
        this.showSuccessModal = true;
        const submitted = saved.date
          ? new Date(saved.date).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric'
            })
          : '';
        this.claims = [
          {
            title: saved.title,
            amount: saved.amount,
            status: saved.status,
            submitted,
            notes: saved.notes ?? ''
          },
          ...this.claims
        ];
        this.approvedMessage = '';
        this.form = { title: '', amount: '', category: 'Travel', date: '', notes: '' };
      })
      .catch(() => {
        this.statusMessage = 'Unable to submit reimbursement.';
      });
  }

  closeSuccessModal() {
    this.showSuccessModal = false;
  }

  showApprovedMessage(claim: { status: string }) {
    if (claim.status.toLowerCase() !== 'approved') {
      return;
    }
    this.approvedMessage = 'Follow up with Accounts team to get your amount reimbursed.';
  }
}
