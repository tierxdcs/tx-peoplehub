import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-tasks',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './tasks.component.html',
  styleUrl: './tasks.component.scss'
})
export class TasksComponent {
  approvals: {
    id: string;
    title: string;
    owner: string;
    due: string;
    source: 'task' | 'leave' | 'reimbursement' | 'requisition';
  }[] = [];

  ngOnInit() {
    this.approvals = [
      ...this.loadUserTasks(),
      ...this.loadLeaveRequests(),
      ...this.loadReimbursements(),
      ...this.loadRequisitions()
    ];
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
        owner: task.owner,
        due: task.due,
        source: 'task' as const
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
      const parsed = JSON.parse(stored) as { type: string; range: string; status: string }[];
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .filter((request) => request.status?.toLowerCase().includes('pending'))
        .map((request, index) => ({
          id: `leave-${index}`,
          title: `Leave request · ${request.type}`,
          owner: 'Employee',
          due: request.range,
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
        .filter((request) => request.category && request.amount)
        .filter((request) => !request.status || request.status.toLowerCase().includes('pending'))
        .map((request, index) => ({
          id: `reimb-${index}`,
          title: `Reimbursement · ${request.category}`,
          owner: request.employee ?? 'Employee',
          due: `₹${request.amount ?? '0'}`,
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
      }[];
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .filter((request) => request.approval?.toLowerCase().includes('pending'))
        .map((request, index) => ({
          id: `req-${index}`,
          title: `Resource requisition · ${request.title}`,
          owner: request.department ?? 'Department',
          due: `${request.headcount} headcount`,
          source: 'requisition' as const
        }));
    } catch {
      localStorage.removeItem('tx-peoplehub-workforce-requests');
      return [];
    }
  }
}
