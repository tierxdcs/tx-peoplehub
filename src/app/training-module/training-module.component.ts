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
  moduleKey = '';
  moduleDue = '';
  questions: { text: string; type: string; options?: string[] }[] = [];
  status = '';
  submitted = false;
  responses: Record<string, Record<number, string | string[]>> = {};
  readonly options = ['Option A', 'Option B', 'Option C'];
  readonly trueFalseOptions = ['True', 'False'];
  private assignment: TrainingAssignment | null = null;
  private employeeName = 'Employee';
  private sessionRole = 'Employee';
  private sessionDepartment = 'Operations';
  scorePercent = 0;
  minScore = 80;

  constructor(private readonly route: ActivatedRoute, private readonly api: ApiService) {}

  async ngOnInit() {
    const rawTitle = this.route.snapshot.paramMap.get('title') ?? '';
    this.moduleKey = decodeURIComponent(rawTitle);
    this.moduleTitle = this.moduleKey;
    if (!this.moduleKey) {
      this.status = 'Training module not found.';
      return;
    }

    this.loadSessionInfo();
    await this.loadAssignments();
    await this.loadStatus();
  }

  loadSessionInfo() {
    const raw = localStorage.getItem('tx-peoplehub-session');
    if (!raw) {
      this.employeeName = 'Employee';
      this.sessionRole = 'Employee';
      this.sessionDepartment = 'Operations';
      return;
    }
    try {
      const parsed = JSON.parse(raw) as { name?: string; role?: string; department?: string };
      this.employeeName = parsed.name?.trim() || 'Employee';
      this.sessionRole = parsed.role?.trim() || 'Employee';
      this.sessionDepartment = parsed.department?.trim() || 'Operations';
    } catch {
      this.employeeName = 'Employee';
      this.sessionRole = 'Employee';
      this.sessionDepartment = 'Operations';
    }
  }

  async loadAssignments() {
    try {
      const assignments = await firstValueFrom(this.api.getTrainingAssignments());
      const looksLikeId = this.moduleKey.includes('-');
      const match = looksLikeId
        ? assignments.find((assignment) => assignment.id === this.moduleKey)
        : assignments.find((assignment) => assignment.title === this.moduleKey);
      if (!match) {
        this.status = 'Training module not found.';
        return;
      }
      this.moduleTitle = match.title;
      const assignedAudience = match.audience ?? 'All employees';
      const assignedDepartment = match.department ?? 'All departments';
      if (assignedAudience !== 'All employees' && assignedAudience !== this.sessionRole) {
        this.status = 'Training module not assigned to your role.';
        return;
      }
      if (
        assignedDepartment !== 'All departments' &&
        assignedDepartment !== this.sessionDepartment
      ) {
        this.status = 'Training module not assigned to your department.';
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
        const last = responses[0];
        if (last.passed) {
          this.submitted = true;
        }
        this.scorePercent = last.score ?? 0;
        this.responses[this.moduleKey] = last.responses ?? {};
      }
    } catch {
      return;
    }
  }

  setResponse(index: number, value: string) {
    this.responses[this.moduleKey] = {
      ...(this.responses[this.moduleKey] ?? {}),
      [index]: value
    };
  }

  getSingleResponse(index: number) {
    const response = this.responses[this.moduleKey]?.[index];
    return typeof response === 'string' ? response : '';
  }

  toggleMultiResponse(index: number, option: string) {
    const current = this.responses[this.moduleKey]?.[index];
    const next = Array.isArray(current) ? [...current] : [];
    const exists = next.includes(option);
    const updated = exists ? next.filter((value) => value !== option) : [...next, option];
    this.responses[this.moduleKey] = {
      ...(this.responses[this.moduleKey] ?? {}),
      [index]: updated
    };
  }

  isMultiSelected(index: number, option: string) {
    const current = this.responses[this.moduleKey]?.[index];
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
    if (!this.moduleKey || !this.assignment) {
      return;
    }
    if (this.submitted) {
      return;
    }
    const assignment = this.assignment;
    const { score, passed } = this.calculateScore(assignment);
    this.scorePercent = score;
    if (!passed) {
      this.status = `Score ${score}% - minimum ${this.minScore}% required to pass.`;
      return;
    }

    const responsePayload = {
      assignmentId: assignment.id,
      employee: this.employeeName,
      responses: this.responses[this.moduleKey] ?? {},
      score,
      passed
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

  calculateScore(assignment: TrainingAssignment) {
    const responses = this.responses[this.moduleKey] ?? {};
    const gradable = assignment.questions.filter((question) => question.correctAnswers !== undefined);
    if (!gradable.length) {
      return { score: 0, passed: false };
    }
    const correctCount = gradable.reduce((count, question, index) => {
      const answer = responses[index];
      if (answer === undefined || answer === null) {
        return count;
      }
      const expected = (question.correctAnswers ?? []).filter(Boolean);
      if (question.type === 'Multiple choice') {
        const selected = Array.isArray(answer) ? answer : [answer as string];
        const normalizedSelected = selected.map((value) => value.toString());
        return count + (this.sameSet(normalizedSelected, expected) ? 1 : 0);
      }
      if (question.type === 'Short answer') {
        const expectedText = (expected[0] ?? '').trim().toLowerCase();
        return count + (answer.toString().trim().toLowerCase() === expectedText ? 1 : 0);
      }
      const expectedValue = expected[0] ?? '';
      return count + (answer === expectedValue ? 1 : 0);
    }, 0);
    const score = Math.round((correctCount / gradable.length) * 100);
    return { score, passed: score >= this.minScore };
  }

  sameSet(a: string[], b: string[]) {
    if (a.length !== b.length) {
      return false;
    }
    const setA = new Set(a);
    return b.every((value) => setA.has(value));
  }

}
