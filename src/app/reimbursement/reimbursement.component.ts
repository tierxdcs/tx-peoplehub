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

  constructor(private readonly api: ApiService) {}

  async ngOnInit() {
    try {
      const reimbursements = await firstValueFrom(this.api.getReimbursements());
      this.claims = reimbursements.map((claim) => ({
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
