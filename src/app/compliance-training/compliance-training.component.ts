import { Component } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-compliance-training',
  standalone: true,
  imports: [RouterLink, DatePipe],
  templateUrl: './compliance-training.component.html',
  styleUrl: './compliance-training.component.scss'
})
export class ComplianceTrainingComponent {
  private readonly assignmentsKey = 'tx-peoplehub-assigned-training';
  private readonly adminKey = 'tx-peoplehub-admin-draft';
  private readonly statusKey = 'tx-peoplehub-training-status';
  trainings: {
    title: string;
    status: string;
    due: string;
    completedAt?: string;
  }[] = [];
  completed = [
    { title: 'Workplace conduct', completed: 'Dec 12' },
    { title: 'Information security', completed: 'Nov 28' },
    { title: 'Equipment handling', completed: 'Oct 6' }
  ];

  ngOnInit() {
    const adminRaw = localStorage.getItem(this.adminKey);
    let department = 'Operations';
    if (adminRaw) {
      try {
        const parsed = JSON.parse(adminRaw) as { department?: string };
        if (parsed.department) {
          department = parsed.department;
        }
      } catch {
        localStorage.removeItem(this.adminKey);
      }
    }

    this.loadAssignments(department);
    this.applyCompletionStatus();
  }

  loadAssignments(department: string) {
    const stored = localStorage.getItem(this.assignmentsKey);
    if (!stored) {
      return;
    }
    try {
      const parsed = JSON.parse(stored) as {
        title: string;
        department?: string;
        dueDate: string;
        questions?: { text: string; type: string }[];
      }[];
      if (Array.isArray(parsed)) {
        this.trainings = parsed
          .filter((assignment) => {
            const assignedDepartment = assignment.department ?? 'All departments';
            return (
              assignedDepartment === 'All departments' ||
              assignedDepartment === department
            );
          })
          .map((assignment) => ({
            title: assignment.title,
            status: 'Required',
            due: assignment.dueDate
          }));
      }
    } catch {
      localStorage.removeItem(this.assignmentsKey);
    }
  }

  applyCompletionStatus() {
    const stored = localStorage.getItem(this.statusKey);
    if (!stored || !this.trainings.length) {
      return;
    }
    try {
      const parsed = JSON.parse(stored) as Record<
        string,
        { completed: boolean; completedAt?: string }
      >;
      if (!parsed || typeof parsed !== 'object') {
        return;
      }
      this.trainings = this.trainings.map((training) => ({
        ...training,
        status: parsed[training.title]?.completed ? 'Completed' : training.status,
        completedAt: parsed[training.title]?.completedAt
      }));
    } catch {
      localStorage.removeItem(this.statusKey);
    }
  }
}
