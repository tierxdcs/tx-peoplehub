import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../services/api.service';

@Component({
  selector: 'app-reimbursement',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './reimbursement.component.html',
  styleUrl: './reimbursement.component.scss'
})
export class ReimbursementComponent {
  claims: { title: string; amount: string; status: string; submitted: string }[] = [];
  employeeEmail = '';
  employeeName = '';

  constructor(private readonly api: ApiService) {}

  async ngOnInit() {
    try {
      const rawSession = localStorage.getItem('tx-peoplehub-session');
      if (rawSession) {
        try {
          const parsed = JSON.parse(rawSession) as { email?: string; name?: string };
          this.employeeEmail = parsed.email?.trim().toLowerCase() ?? '';
          this.employeeName = parsed.name?.trim() ?? '';
        } catch {
          this.employeeEmail = '';
          this.employeeName = '';
        }
      }
      const reimbursements = await firstValueFrom(
        this.api.getReimbursements({
          employeeEmail: this.employeeEmail || undefined,
          employeeName: this.employeeName || undefined
        })
      );
      this.claims = reimbursements
        .filter((claim) => {
          if (this.employeeEmail) {
            return claim.employeeEmail?.toLowerCase() === this.employeeEmail;
          }
          if (this.employeeName) {
            return claim.employee === this.employeeName;
          }
          return false;
        })
        .map((claim) => ({
          title: claim.title,
          amount: claim.amount,
          status: claim.status,
          submitted: claim.date
            ? new Date(claim.date).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric'
              })
            : ''
        }));
    } catch {
      this.claims = [];
    }
  }
}
