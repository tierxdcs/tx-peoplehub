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

  constructor(private readonly api: ApiService) {}

  async ngOnInit() {
    try {
      const rawSession = localStorage.getItem('tx-peoplehub-session');
      if (rawSession) {
        try {
          const parsed = JSON.parse(rawSession) as { email?: string };
          this.employeeEmail = parsed.email?.trim().toLowerCase() ?? '';
        } catch {
          this.employeeEmail = '';
        }
      }
      if (!this.employeeEmail) {
        this.claims = [];
        return;
      }
      const reimbursements = await firstValueFrom(
        this.api.getReimbursements({
          employeeEmail: this.employeeEmail
        })
      );
      this.claims = reimbursements
        .filter((claim) => claim.employeeEmail?.toLowerCase() === this.employeeEmail)
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
