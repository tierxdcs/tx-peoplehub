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
  approvals: {
    id: string;
    title: string;
    owner: string;
    due: string;
    source: 'task' | 'leave' | 'reimbursement' | 'requisition';
  }[] = [];
  completed: {
    id: string;
    title: string;
    owner: string;
    due: string;
    status: string;
  }[] = [];

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
        } catch {
          this.sessionEmail = '';
          this.sessionName = '';
          this.isDirector = false;
        }
      }
      if (!this.isDirector) {
        this.approvals = [];
        this.completed = [];
        return;
      }
      const [tasks, leaves, reimbursements, requisitions, completed] = await Promise.all([
        firstValueFrom(
          this.api.getTasks({
            ownerEmail: this.sessionEmail || undefined,
            ownerName: this.sessionName || undefined
          })
        ),
        firstValueFrom(this.api.getLeaves()),
        firstValueFrom(this.api.getReimbursements()),
        firstValueFrom(this.api.getRequisitions()),
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
            source: 'reimbursement' as const
          })),
        ...requisitions
          .filter((request) => request.approval?.toLowerCase().includes('pending'))
          .map((request) => ({
            id: request.id,
            title: `Resource requisition · ${request.title}`,
            owner: request.department ?? '',
            due: `${request.headcount} headcount`,
            source: 'requisition' as const
          }))
      ];

      this.completed = completed.map((item) => ({
        id: item.id,
        title: item.title,
        owner: item.submittedBy ?? 'Employee',
        due: item.summary ?? '',
        status: item.status
      }));
    } catch {
      this.approvals = [];
      this.completed = [];
    }
  }
}
