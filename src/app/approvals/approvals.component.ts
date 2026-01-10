import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../services/api.service';

@Component({
  selector: 'app-approvals',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './approvals.component.html',
  styleUrl: './approvals.component.scss'
})
export class ApprovalsComponent {
  private readonly route = inject(ActivatedRoute);
  sessionEmail = '';
  sessionName = '';
  isDirector = false;
  isCfo = false;
  requests: {
    id: string;
    title: string;
    submittedBy: string;
    summary: string;
    status: string;
    requestNote: string;
    source: 'task' | 'leave' | 'reimbursement' | 'requisition';
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

  constructor(private readonly api: ApiService) {}

  async ngOnInit() {
    this.loadSession();
    await this.loadRequests();
    const openId = this.route.snapshot.queryParamMap.get('open');
    if (openId) {
      const match = this.requests.find((request) => request.id === openId);
      if (match) {
        this.openRequest(match);
      }
    }
  }

  loadSession() {
    const raw = localStorage.getItem('tx-peoplehub-session');
    if (!raw) {
      this.sessionEmail = '';
      this.sessionName = '';
      this.isDirector = false;
      this.isCfo = false;
      return;
    }
    try {
      const parsed = JSON.parse(raw) as { email?: string; name?: string; director?: string };
      this.sessionEmail = parsed.email?.trim().toLowerCase() || '';
      this.sessionName = parsed.name?.trim() || '';
      this.isDirector = parsed.director === 'Yes';
      this.isCfo = this.sessionName.toLowerCase() === 'ravi kulal';
    } catch {
      this.sessionEmail = '';
      this.sessionName = '';
      this.isDirector = false;
      this.isCfo = false;
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
    this.persistDecision(decision);
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
    this.persistDecision(decision);
  }

  async loadRequests() {
    try {
      const [tasks, leaves, reimbursements, requisitions, completed] = await Promise.all([
        firstValueFrom(
          this.api.getTasks({
            ownerEmail: this.sessionEmail || undefined,
            ownerName: this.sessionName || undefined
          })
        ),
        this.sessionName
          ? firstValueFrom(this.api.getLeaves({ managerName: this.sessionName }))
          : Promise.resolve([]),
        this.isCfo
          ? firstValueFrom(this.api.getReimbursements({ scope: 'all' }))
          : Promise.resolve([]),
        this.isDirector
          ? firstValueFrom(this.api.getRequisitions({ scope: 'all' }))
          : Promise.resolve([]),
        firstValueFrom(this.api.getCompletedApprovals())
      ]);

      this.requests = [
        ...tasks.map((task) => ({
          id: task.id,
          title: task.title,
          submittedBy: task.owner,
          summary: task.due,
          status: 'Pending',
          requestNote: '',
          source: 'task' as const
        })),
        ...leaves
          .filter((request) => request.status?.toLowerCase().includes('pending'))
          .map((request) => ({
            id: request.id,
            title: `Leave request · ${request.type}`,
            submittedBy: request.employeeName ?? '',
            summary: request.range,
            status: request.status || 'Pending manager approval',
            requestNote: request.notes ?? '',
            source: 'leave' as const
          })),
        ...reimbursements
          .filter((request) => request.category && request.amount)
          .filter((request) => !request.status || request.status.toLowerCase().includes('pending'))
          .map((request) => ({
            id: request.id,
            title: `Reimbursement · ${request.category}`,
            submittedBy: request.employee ?? 'Employee',
            summary: request.amount,
            status: request.status || 'Pending CFO approval',
            requestNote: request.notes ?? '',
            source: 'reimbursement' as const
          })),
        ...requisitions
          .filter((request) => request.approval?.toLowerCase().includes('pending'))
          .map((request) => ({
            id: request.id,
            title: `Resource requisition · ${request.title}`,
            submittedBy: request.manager || request.requesterEmail || '',
            summary: `${request.department} · ${request.headcount} headcount`,
            status: request.approval ?? 'Pending Board Directors approval',
            requestNote: request.justification ?? '',
            source: 'requisition' as const
          }))
      ];

      this.completed = completed.map((item) => ({
        id: item.id,
        title: item.title,
        submittedBy: item.submittedBy ?? '',
        summary: item.summary ?? '',
        status: item.status
      }));
    } catch {
      this.requests = [];
      this.completed = [];
    }
  }

  persistDecision(decision: {
    id: string;
    source: 'task' | 'leave' | 'reimbursement' | 'requisition';
    status: string;
    title: string;
    submittedBy: string;
    summary: string;
  }) {
    const note = this.decisionNote.trim();
    const completedPayload = {
      source: decision.source,
      sourceId: decision.id,
      title: decision.title,
      submittedBy: decision.submittedBy,
      summary: decision.summary,
      status: decision.status,
      note
    };

    const updateRequest =
      decision.source === 'task'
        ? firstValueFrom(this.api.deleteTask(decision.id))
        : decision.source === 'leave'
          ? firstValueFrom(this.api.updateLeaveStatus(decision.id, decision.status))
          : decision.source === 'reimbursement'
            ? firstValueFrom(this.api.updateReimbursementStatus(decision.id, decision.status))
            : firstValueFrom(this.api.updateRequisitionApproval(decision.id, decision.status));

    Promise.all([
      firstValueFrom(this.api.createCompletedApproval(completedPayload)),
      updateRequest
    ])
      .then(([saved]) => {
        this.completed = [saved, ...this.completed];
        this.requests = this.requests.filter((item) => item.id !== decision.id);
        this.closeRequest();
      })
      .catch(() => {
        this.noteError = 'Unable to update approval.';
      });
  }
}
