import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-approvals',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './approvals.component.html',
  styleUrl: './approvals.component.scss'
})
export class ApprovalsComponent {
  requests: {
    id: string;
    title: string;
    submittedBy: string;
    summary: string;
    status: string;
    source: 'leave' | 'reimbursement' | 'requisition';
  }[] = [];
  selectedRequest: (typeof this.requests)[number] | null = null;
  decisionNote = '';
  noteError = '';

  ngOnInit() {
    this.requests = [
      ...this.loadLeaveRequests(),
      ...this.loadReimbursements(),
      ...this.loadRequisitions()
    ];
  }

  openRequest(request: (typeof this.requests)[number]) {
    this.selectedRequest = request;
    this.decisionNote = '';
    this.noteError = '';
  }

  closeRequest() {
    this.selectedRequest = null;
    this.decisionNote = '';
    this.noteError = '';
  }

  approveRequest() {
    if (!this.selectedRequest) {
      return;
    }
    if (!this.decisionNote.trim()) {
      this.noteError = 'Add a note before approving.';
      return;
    }
    this.selectedRequest = {
      ...this.selectedRequest,
      status: 'Approved'
    };
    this.closeRequest();
  }

  rejectRequest() {
    if (!this.selectedRequest) {
      return;
    }
    if (!this.decisionNote.trim()) {
      this.noteError = 'Add a note before rejecting.';
      return;
    }
    this.selectedRequest = {
      ...this.selectedRequest,
      status: 'Rejected'
    };
    this.closeRequest();
  }

  loadLeaveRequests() {
    const stored = localStorage.getItem('tx-peoplehub-leave-requests');
    if (!stored) {
      return [];
    }
    try {
      const parsed = JSON.parse(stored) as {
        type: string;
        range: string;
        status: string;
      }[];
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .filter((request) => request.status?.toLowerCase().includes('pending'))
        .map((request, index) => ({
          id: `leave-${index}`,
          title: `Leave request · ${request.type}`,
          submittedBy: 'Employee',
          summary: request.range,
          status: 'Pending manager approval',
          source: 'leave' as const
        }));
    } catch {
      localStorage.removeItem('tx-peoplehub-leave-requests');
      return [];
    }
  }

  loadReimbursements() {
    const stored = localStorage.getItem('tx-peoplehub-reimbursements');
    if (!stored) {
      return [];
    }
    try {
      const parsed = JSON.parse(stored) as {
        category: string;
        amount: string;
        employee: string;
        status?: string;
      }[];
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .filter((request) => !request.status || request.status.toLowerCase().includes('pending'))
        .map((request, index) => ({
          id: `reimb-${index}`,
          title: `Reimbursement · ${request.category}`,
          submittedBy: request.employee ?? 'Employee',
          summary: `₹${request.amount ?? '0'}`,
          status: 'Pending CFO approval',
          source: 'reimbursement' as const
        }));
    } catch {
      localStorage.removeItem('tx-peoplehub-reimbursements');
      return [];
    }
  }

  loadRequisitions() {
    const stored = localStorage.getItem('tx-peoplehub-workforce-requests');
    if (!stored) {
      return [];
    }
    try {
      const parsed = JSON.parse(stored) as {
        title: string;
        department: string;
        headcount: number;
        approval: string;
        manager: string;
      }[];
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .filter((request) => request.approval?.toLowerCase().includes('pending'))
        .map((request, index) => ({
          id: `req-${index}`,
          title: `Resource requisition · ${request.title}`,
          submittedBy: request.manager ?? 'Manager',
          summary: `${request.department} · ${request.headcount} headcount`,
          status: request.approval ?? 'Pending CFO & CEO approval',
          source: 'requisition' as const
        }));
    } catch {
      localStorage.removeItem('tx-peoplehub-workforce-requests');
      return [];
    }
  }
}
