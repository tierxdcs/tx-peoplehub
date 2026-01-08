import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService, TrainingAssignment } from '../services/api.service';

@Component({
  selector: 'app-training-module',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './training-module.component.html',
  styleUrl: './training-module.component.scss'
})
export class TrainingModuleComponent {
  moduleTitle = '';
  moduleDue = '';
  questions: { text: string; type: string; options?: string[] }[] = [];
  status = '';
  submitted = false;
  responses: Record<string, Record<number, string | string[]>> = {};
  readonly options = ['Option A', 'Option B', 'Option C'];
  readonly trueFalseOptions = ['True', 'False'];
  private assignment: TrainingAssignment | null = null;
  private employeeName = 'Employee';

  constructor(private readonly route: ActivatedRoute, private readonly api: ApiService) {}

  async ngOnInit() {
    const rawTitle = this.route.snapshot.paramMap.get('title') ?? '';
    this.moduleTitle = decodeURIComponent(rawTitle);
    if (!this.moduleTitle) {
      this.status = 'Training module not found.';
      return;
    }

    const profile = await firstValueFrom(this.api.getEmployeeProfile());
    this.employeeName = profile?.fullName ?? 'Employee';
    await this.loadAssignments();
    await this.loadStatus();
  }

  async loadAssignments() {
    try {
      const assignments = await firstValueFrom(this.api.getTrainingAssignments());
      const match = assignments.find((assignment) => assignment.title === this.moduleTitle);
      if (!match) {
        this.status = 'Training module not found.';
        return;
      }
      this.assignment = match;
      this.moduleDue = match.dueDate;
      this.questions = match.questions ?? [];
    } catch {
      this.status = 'Training module not found.';
    }
  }

  async loadStatus() {
    if (!this.assignment) {
      return;
    }
    try {
      const responses = await firstValueFrom(
        this.api.getTrainingResponses({
          assignmentId: this.assignment.id,
          employee: this.employeeName
        })
      );
      if (responses.length) {
        this.submitted = true;
        this.responses[this.moduleTitle] = responses[0]?.responses ?? {};
      }
    } catch {
      return;
    }
  }

  setResponse(index: number, value: string) {
    this.responses[this.moduleTitle] = {
      ...(this.responses[this.moduleTitle] ?? {}),
      [index]: value
    };
  }

  getSingleResponse(index: number) {
    const response = this.responses[this.moduleTitle]?.[index];
    return typeof response === 'string' ? response : '';
  }

  toggleMultiResponse(index: number, option: string) {
    const current = this.responses[this.moduleTitle]?.[index];
    const next = Array.isArray(current) ? [...current] : [];
    const exists = next.includes(option);
    const updated = exists ? next.filter((value) => value !== option) : [...next, option];
    this.responses[this.moduleTitle] = {
      ...(this.responses[this.moduleTitle] ?? {}),
      [index]: updated
    };
  }

  isMultiSelected(index: number, option: string) {
    const current = this.responses[this.moduleTitle]?.[index];
    return Array.isArray(current) && current.includes(option);
  }

  getQuestionOptions(question: { type: string; options?: string[] }) {
    if (question.type === 'True/False') {
      return question.options?.length ? question.options : this.trueFalseOptions;
    }
    if (question.type === 'Multiple choice' || question.type === 'Single choice') {
      return question.options?.length ? question.options : this.options;
    }
    return [];
  }

  submitModule() {
    if (!this.moduleTitle || !this.assignment) {
      return;
    }
    if (this.submitted) {
      return;
    }
    const assignment = this.assignment;
    const responsePayload = {
      assignmentId: assignment.id,
      employee: this.employeeName,
      responses: this.responses[this.moduleTitle] ?? {}
    };
    firstValueFrom(this.api.createTrainingResponse(responsePayload))
      .then(() => {
        const participants = Array.isArray(assignment.participants)
          ? [...assignment.participants]
          : [];
        const existingIndex = participants.findIndex(
          (participant) => participant.name === this.employeeName
        );
        if (existingIndex >= 0) {
          participants[existingIndex] = { ...participants[existingIndex], status: 'Completed' };
        } else {
          participants.push({ name: this.employeeName, status: 'Completed' });
        }
        const completed = participants.filter((participant) => participant.status === 'Completed')
          .length;
        const total = assignment.total || participants.length;
        return firstValueFrom(
          this.api.updateTrainingAssignment(assignment.id, {
            questions: assignment.questions,
            participants,
            completed,
            total
          })
        );
      })
      .then(() => {
        this.submitted = true;
        this.status = 'Module submitted.';
      })
      .catch(() => {
        this.status = 'Unable to submit module.';
      });
  }

}
