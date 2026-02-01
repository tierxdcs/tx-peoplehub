import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService, ReimbursementRecord } from '../services/api.service';

type ReimbursementRow = ReimbursementRecord & {
  statusChoice: string;
  note: string;
  saving?: boolean;
  error?: string;
};

@Component({
  selector: 'app-reimbursement-ops',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './reimbursement-ops.component.html',
  styleUrl: './reimbursement-ops.component.scss'
})
export class ReimbursementOpsComponent {
  approvals: ReimbursementRow[] = [];
  isAuthorized = false;
  statusMessage = '';

  constructor(private readonly api: ApiService) {}

  async ngOnInit() {
    this.isAuthorized = this.checkAccess();
    if (!this.isAuthorized) {
      this.statusMessage = 'You do not have access to reimbursement approvals.';
      return;
    }
    await this.loadApprovals();
  }

  checkAccess() {
    const raw = localStorage.getItem('tx-peoplehub-session');
    if (!raw) {
      return false;
    }
    try {
      const parsed = JSON.parse(raw) as { name?: string; email?: string };
      const name = parsed.name?.trim().toLowerCase() || '';
      const email = parsed.email?.trim().toLowerCase() || '';
      return (
        name === 'ravi kulal' ||
        name === 'jeevan s' ||
        email === 'ravikulal.h@tierxdcs.com' ||
        email === 'jeevan.s@tierxdcs.com'
      );
    } catch {
      return false;
    }
  }

  async loadApprovals() {
    try {
      const reimbursements = await firstValueFrom(
        this.api.getReimbursements({ scope: 'all' })
      );
      this.approvals = reimbursements
        .filter((item) => String(item.status ?? '').toLowerCase().includes('approved'))
        .map((item) => ({
          ...item,
          statusChoice: 'Reimbursement complete',
          note: ''
        }));
      if (!this.approvals.length) {
        this.statusMessage = 'No approved reimbursements to complete.';
      } else {
        this.statusMessage = '';
      }
    } catch {
      this.approvals = [];
      this.statusMessage = 'Unable to load reimbursement approvals.';
    }
  }

  async submitDecision(item: ReimbursementRow) {
    if (item.saving) {
      return;
    }
    item.error = '';
    if (item.statusChoice.toLowerCase().includes('complete') && !item.note.trim()) {
      item.error = 'Add a note before completing reimbursement.';
      return;
    }
    item.saving = true;
    try {
      const status = item.statusChoice;
      await firstValueFrom(this.api.updateReimbursementStatus(item.id, status));
      if (item.note.trim()) {
        await firstValueFrom(
          this.api.createCompletedApproval({
            source: 'reimbursement',
            sourceId: item.id,
            title: `Reimbursement · ${item.category}`,
            submittedBy: item.employee ?? 'Employee',
            summary: item.amount,
            status,
            note: item.note.trim()
          })
        );
      }
      this.approvals = this.approvals.filter((row) => row.id !== item.id);
      if (!this.approvals.length) {
        this.statusMessage = 'No reimbursement approvals to review.';
      }
    } catch {
      item.error = 'Unable to update reimbursement.';
    } finally {
      item.saving = false;
    }
  }
}
