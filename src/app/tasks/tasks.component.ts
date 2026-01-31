import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../services/api.service';

@Component({
  selector: 'app-tasks',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './tasks.component.html',
  styleUrl: './tasks.component.scss'
})
export class TasksComponent {
  sessionEmail = '';
  sessionName = '';
  isDirector = false;
  isCoo = false;
  approvals: {
    id: string;
    title: string;
    owner: string;
    due: string;
    source: 'task' | 'leave' | 'reimbursement' | 'requisition';
    requestNote?: string;
  }[] = [];
  completed: {
    id: string;
    title: string;
    owner: string;
    due: string;
    status: string;
    source: 'task' | 'leave' | 'reimbursement' | 'requisition';
    sourceId: string;
    requestNote?: string;
  }[] = [];
  selectedTask: {
    id: string;
    title: string;
    owner: string;
    due: string;
    status: string;
    source: 'task' | 'leave' | 'reimbursement' | 'requisition';
    sourceId?: string;
    requestNote?: string;
    isCompleted: boolean;
  } | null = null;

  constructor(private readonly api: ApiService) {}

  async ngOnInit() {
    try {
      const raw = localStorage.getItem('tx-peoplehub-session');
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { email?: string; name?: string; director?: string };
          this.sessionEmail = parsed.email?.trim().toLowerCase() || '';
          this.sessionName = parsed.name?.trim() || '';
          this.isDirector = parsed.director === 'Yes';
          this.isCoo = this.sessionName.toLowerCase() === 'ravi kulal';
        } catch {
          this.sessionEmail = '';
          this.sessionName = '';
          this.isDirector = false;
          this.isCoo = false;
        }
      }
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
        this.isCoo
          ? firstValueFrom(this.api.getReimbursements({ scope: 'all' }))
          : Promise.resolve([]),
        this.isDirector
          ? firstValueFrom(this.api.getRequisitions({ scope: 'all' }))
          : Promise.resolve([]),
        firstValueFrom(this.api.getCompletedApprovals())
      ]);

      this.approvals = [
        ...tasks.map((task) => ({
          id: task.id,
          title: task.title,
          owner: task.owner,
          due: task.due,
          source: 'task' as const
        })),
        ...leaves
          .filter((request) => request.status?.toLowerCase().includes('pending'))
          .map((request) => ({
            id: request.id,
            title: `Leave request · ${request.type}`,
            owner: request.employeeName ?? '',
            due: request.range,
            source: 'leave' as const
          })),
        ...reimbursements
          .filter((request) => !request.status || request.status.toLowerCase().includes('pending'))
          .map((request) => ({
            id: request.id,
            title: `Reimbursement · ${request.category}`,
            owner: request.employee ?? '',
            due: request.amount,
            source: 'reimbursement' as const,
            requestNote: request.notes ?? ''
          })),
        ...requisitions
          .filter((request) => request.approval?.toLowerCase().includes('pending'))
          .map((request) => ({
            id: request.id,
            title: `Resource requisition · ${request.title}`,
            owner: request.manager || request.requesterEmail || '',
            due: `${request.headcount} headcount`,
            source: 'requisition' as const
          }))
      ];

      this.completed = completed.map((item) => ({
        id: item.id,
        title: item.title,
        owner: item.submittedBy ?? 'Employee',
        due: item.summary ?? '',
        status: item.status,
        source: (item.source as 'task' | 'leave' | 'reimbursement' | 'requisition') ?? 'task',
        sourceId: item.sourceId,
        requestNote:
          item.source === 'reimbursement'
            ? reimbursements.find((claim) => claim.id === item.sourceId)?.notes ?? ''
            : ''
      }));
    } catch {
      this.approvals = [];
      this.completed = [];
    }
  }

  openTask(
    task: {
      id: string;
      title: string;
      owner: string;
      due: string;
      status?: string;
      source: 'task' | 'leave' | 'reimbursement' | 'requisition';
      sourceId?: string;
      requestNote?: string;
    },
    isCompleted: boolean
  ) {
    this.selectedTask = {
      id: task.id,
      title: task.title,
      owner: task.owner,
      due: task.due,
      status: isCompleted ? task.status || 'Completed' : 'Pending',
      source: task.source,
      sourceId: task.sourceId,
      requestNote: task.requestNote,
      isCompleted
    };
  }

  closeTask() {
    this.selectedTask = null;
  }
}
