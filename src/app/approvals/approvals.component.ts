import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-approvals',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './approvals.component.html',
  styleUrl: './approvals.component.scss'
})
export class ApprovalsComponent {
  requests = [
    {
      id: 'leave-pta-021',
      title: 'Leave request · PTO',
      submittedBy: 'Jessie Moore',
      summary: 'Feb 12 - Feb 14 · 3 days',
      status: 'Pending manager approval'
    },
    {
      id: 'reimb-1982',
      title: 'Reimbursement request · Home office',
      submittedBy: 'Iman Shah',
      summary: '₹3,400 · Desk equipment',
      status: 'Pending CFO approval'
    },
    {
      id: 'req-ops-009',
      title: 'Resource requisition · Network Engineer',
      submittedBy: 'Chloe Bishop',
      summary: 'Operations · 1 headcount',
      status: 'Pending CFO & CEO approval'
    }
  ];
  selectedRequest: (typeof this.requests)[number] | null = null;

  openRequest(request: (typeof this.requests)[number]) {
    this.selectedRequest = request;
  }

  closeRequest() {
    this.selectedRequest = null;
  }

  approveRequest() {
    if (!this.selectedRequest) {
      return;
    }
    this.selectedRequest = {
      ...this.selectedRequest,
      status: 'Approved'
    };
  }

  rejectRequest() {
    if (!this.selectedRequest) {
      return;
    }
    this.selectedRequest = {
      ...this.selectedRequest,
      status: 'Rejected'
    };
  }
}
