import { Component } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService, TrainingAssignment, TrainingResponse } from '../services/api.service';

@Component({
  selector: 'app-compliance-training',
  standalone: true,
  imports: [RouterLink, DatePipe],
  templateUrl: './compliance-training.component.html',
  styleUrl: './compliance-training.component.scss'
})
export class ComplianceTrainingComponent {
  trainings: {
    assignmentId: string;
    title: string;
    status: string;
    due: string;
    completedAt?: string;
  }[] = [];
  completedTrainings: { title: string; completedAt: string }[] = [];
  sessionDepartment = 'Operations';
  sessionName = 'Employee';

  constructor(private readonly api: ApiService) {}

  async ngOnInit() {
    this.loadSession();
    const department = this.sessionDepartment;
    const employeeName = this.sessionName;

    const [assignments, responses] = await Promise.all([
      firstValueFrom(this.api.getTrainingAssignments()),
      firstValueFrom(this.api.getTrainingResponses({ employee: employeeName }))
    ]);

    this.loadAssignments(department, assignments);
    this.applyCompletionStatus(responses);
    this.splitCompleted();
  }

  loadSession() {
    const raw = localStorage.getItem('tx-peoplehub-session');
    if (!raw) {
      return;
    }
    try {
      const parsed = JSON.parse(raw) as { name?: string; department?: string };
      this.sessionName = parsed.name?.trim() || this.sessionName;
      this.sessionDepartment = parsed.department?.trim() || this.sessionDepartment;
    } catch {
      return;
    }
  }

  loadAssignments(department: string, assignments: TrainingAssignment[]) {
    this.trainings = assignments
      .filter((assignment) => {
        const assignedDepartment = assignment.department ?? 'All departments';
        return assignedDepartment === 'All departments' || assignedDepartment === department;
      })
      .map((assignment) => ({
        assignmentId: assignment.id,
        title: assignment.title,
        status: 'Required',
        due: assignment.dueDate
      }));
  }

  applyCompletionStatus(responses: TrainingResponse[]) {
    if (!this.trainings.length) {
      return;
    }
    const responseMap = responses.reduce<Record<string, TrainingResponse>>((acc, response) => {
      if (response.passed) {
        acc[response.assignmentId] = response;
      }
      return acc;
    }, {});
    this.trainings = this.trainings.map((training) => {
      const response = responseMap[training.assignmentId];
      const completedAt = response?.submittedAt;
      return {
        ...training,
        status: completedAt ? 'Completed' : training.status,
        completedAt
      };
    });
  }

  splitCompleted() {
    this.completedTrainings = this.trainings
      .filter((training) => training.status === 'Completed' && training.completedAt)
      .map((training) => ({
        title: training.title,
        completedAt: training.completedAt as string
      }));
    this.trainings = this.trainings.filter((training) => training.status !== 'Completed');
  }
}
