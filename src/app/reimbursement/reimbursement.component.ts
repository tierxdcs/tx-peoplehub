import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-reimbursement',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './reimbursement.component.html',
  styleUrl: './reimbursement.component.scss'
})
export class ReimbursementComponent {
  private readonly storageKey = 'tx-peoplehub-reimbursements';
  claims = [
    {
      title: 'Home office equipment',
      amount: '₹280.00',
      status: 'Pending',
      submitted: 'Jan 18'
    },
    {
      title: 'Client travel',
      amount: '₹1,240.00',
      status: 'Approved',
      submitted: 'Jan 10'
    },
    {
      title: 'Certification fees',
      amount: '₹160.00',
      status: 'Pending',
      submitted: 'Jan 4'
    }
  ];

  ngOnInit() {
    const stored = localStorage.getItem(this.storageKey);
    if (!stored) {
      return;
    }
    try {
      const parsed = JSON.parse(stored) as typeof this.claims;
      if (Array.isArray(parsed) && parsed.length) {
        this.claims = [...parsed, ...this.claims];
      }
    } catch {
      localStorage.removeItem(this.storageKey);
    }
  }
}
