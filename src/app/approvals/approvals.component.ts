import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

@Component({
  selector: 'app-approvals',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './approvals.component.html',
  styleUrl: './approvals.component.scss'
})
export class ApprovalsComponent {
  private readonly route = inject(ActivatedRoute);
  requests: {
    id: string;
    title: string;
    submittedBy: string;
    summary: string;
    status: string;
    source: 'task' | 'leave' | 'reimbursement' | 'requisition';
    sourceIndex?: number;
  }[] = [];
  completed: {
    id: string;
    title: string;
    submittedBy: string;
    summary: string;
    status: string;
  }[] = [];
  selectedRequest: (typeof this.requests)[number] | null = null;
  decisionNote = '';
  noteError = '';

  ngOnInit() {
    this.completed = this.loadCompleted();
    this.requests = [
      ...this.loadUserTasks(),
      ...this.loadLeaveRequests(),
      ...this.loadReimbursements(),
      ...this.loadRequisitions()
    ];
    const openId = this.route.snapshot.queryParamMap.get('open');
    if (openId) {
      const match = this.requests.find((request) => request.id === openId);
      if (match) {
        this.openRequest(match);
      }
    }
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
    const decision = { ...this.selectedRequest, status: 'Approved' };
    this.completed = [decision, ...this.completed];
    this.saveCompleted();
    this.persistDecision(decision);
    this.requests = this.requests.filter((item) => item.id !== decision.id);
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
    const decision = { ...this.selectedRequest, status: 'Rejected' };
    this.completed = [decision, ...this.completed];
    this.saveCompleted();
    this.persistDecision(decision);
    this.requests = this.requests.filter((item) => item.id !== decision.id);
    this.closeRequest();
  }

  loadUserTasks() {
    const stored = localStorage.getItem('tx-peoplehub-tasks');
    if (!stored) {
      return [];
    }
    try {
      const parsed = JSON.parse(stored) as { id?: string; title: string; owner: string; due: string }[];
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.map((task, index) => ({
        id: task.id ?? `task-${index}`,
        title: task.title,
        submittedBy: task.owner,
        summary: task.due,
        status: 'Pending',
        source: 'task' as const,
        sourceIndex: index
      }));
    } catch {
      localStorage.removeItem('tx-peoplehub-tasks');
      return [];
    }
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
          submittedBy: request.employee ?? '',
          summary: request.range,
          status: 'Pending manager approval',
          source: 'leave' as const,
          sourceIndex: index
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
        .filter((request) => request.category && request.amount)
        .filter((request) => !request.status || request.status.toLowerCase().includes('pending'))
        .map((request, index) => ({
          id: `reimb-${index}`,
          title: `Reimbursement · ${request.category}`,
          submittedBy: request.employee ?? 'Employee',
          summary: `₹${request.amount ?? '0'}`,
          status: 'Pending CFO approval',
          source: 'reimbursement' as const,
          sourceIndex: index
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
          submittedBy: request.manager ?? '',
          summary: `${request.department} · ${request.headcount} headcount`,
          status: request.approval ?? 'Pending CFO & CEO approval',
          source: 'requisition' as const,
          sourceIndex: index
        }));
    } catch {
      localStorage.removeItem('tx-peoplehub-workforce-requests');
      return [];
    }
  }

  persistDecision(decision: {
    source: 'task' | 'leave' | 'reimbursement' | 'requisition';
    sourceIndex?: number;
    status: string;
  }) {
    if (decision.source === 'task') {
      const stored = localStorage.getItem('tx-peoplehub-tasks');
      if (!stored) {
        return;
      }
      try {
        const parsed = JSON.parse(stored) as { id?: string }[];
        if (Array.isArray(parsed)) {
          const next = parsed.filter((_, index) => index !== decision.sourceIndex);
          localStorage.setItem('tx-peoplehub-tasks', JSON.stringify(next));
        }
      } catch {
        localStorage.removeItem('tx-peoplehub-tasks');
      }
      return;
    }

    if (decision.source === 'leave') {
      const stored = localStorage.getItem('tx-peoplehub-leave-requests');
      if (!stored) {
        return;
      }
      try {
        const parsed = JSON.parse(stored) as { status?: string }[];
        if (Array.isArray(parsed) && decision.sourceIndex !== undefined) {
          parsed[decision.sourceIndex] = {
            ...parsed[decision.sourceIndex],
            status: decision.status
          };
          localStorage.setItem('tx-peoplehub-leave-requests', JSON.stringify(parsed));
        }
      } catch {
        localStorage.removeItem('tx-peoplehub-leave-requests');
      }
      return;
    }

    if (decision.source === 'reimbursement') {
      const stored = localStorage.getItem('tx-peoplehub-reimbursements');
      if (!stored) {
        return;
      }
      try {
        const parsed = JSON.parse(stored) as { status?: string }[];
        if (Array.isArray(parsed) && decision.sourceIndex !== undefined) {
          parsed[decision.sourceIndex] = {
            ...parsed[decision.sourceIndex],
            status: decision.status
          };
          localStorage.setItem('tx-peoplehub-reimbursements', JSON.stringify(parsed));
        }
      } catch {
        localStorage.removeItem('tx-peoplehub-reimbursements');
      }
      return;
    }

    if (decision.source === 'requisition') {
      const stored = localStorage.getItem('tx-peoplehub-workforce-requests');
      if (!stored) {
        return;
      }
      try {
        const parsed = JSON.parse(stored) as { approval?: string }[];
        if (Array.isArray(parsed) && decision.sourceIndex !== undefined) {
          parsed[decision.sourceIndex] = {
            ...parsed[decision.sourceIndex],
            approval: decision.status
          };
          localStorage.setItem('tx-peoplehub-workforce-requests', JSON.stringify(parsed));
        }
      } catch {
        localStorage.removeItem('tx-peoplehub-workforce-requests');
      }
    }
  }

  loadCompleted() {
    const stored = localStorage.getItem('tx-peoplehub-approvals-completed');
    if (!stored) {
      return [];
    }
    try {
      const parsed = JSON.parse(stored) as typeof this.completed;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      localStorage.removeItem('tx-peoplehub-approvals-completed');
      return [];
    }
  }

  saveCompleted() {
    localStorage.setItem(
      'tx-peoplehub-approvals-completed',
      JSON.stringify(this.completed)
    );
  }
}
