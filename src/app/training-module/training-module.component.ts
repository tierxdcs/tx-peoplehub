import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

@Component({
  selector: 'app-training-module',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './training-module.component.html',
  styleUrl: './training-module.component.scss'
})
export class TrainingModuleComponent {
  private readonly assignmentsKey = 'tx-peoplehub-assigned-training';
  private readonly responsesKey = 'tx-peoplehub-training-responses';
  moduleTitle = '';
  moduleDue = '';
  questions: { text: string; type: string }[] = [];
  status = '';
  responses: Record<string, Record<number, string | string[]>> = {};
  readonly options = ['Option A', 'Option B', 'Option C'];
  readonly trueFalseOptions = ['True', 'False'];

  constructor(private readonly route: ActivatedRoute) {}

  ngOnInit() {
    const rawTitle = this.route.snapshot.paramMap.get('title') ?? '';
    this.moduleTitle = decodeURIComponent(rawTitle);
    if (!this.moduleTitle) {
      this.status = 'Training module not found.';
      return;
    }

    this.loadAssignments();
    this.loadResponses();
  }

  loadAssignments() {
    const stored = localStorage.getItem(this.assignmentsKey);
    if (!stored) {
      this.status = 'Training module not found.';
      return;
    }
    try {
      const parsed = JSON.parse(stored) as {
        title: string;
        dueDate: string;
        questions?: { text: string; type: string }[];
      }[];
      const match = Array.isArray(parsed)
        ? parsed.find((assignment) => assignment.title === this.moduleTitle)
        : undefined;
      if (!match) {
        this.status = 'Training module not found.';
        return;
      }
      this.moduleDue = match.dueDate;
      this.questions = match.questions ?? [];
    } catch {
      localStorage.removeItem(this.assignmentsKey);
      this.status = 'Training module not found.';
    }
  }

  loadResponses() {
    const stored = localStorage.getItem(this.responsesKey);
    if (!stored) {
      return;
    }
    try {
      const parsed = JSON.parse(stored) as Record<string, Record<number, string | string[]>>;
      if (parsed && typeof parsed === 'object') {
        this.responses = parsed;
      }
    } catch {
      localStorage.removeItem(this.responsesKey);
    }
  }

  saveResponses() {
    localStorage.setItem(this.responsesKey, JSON.stringify(this.responses));
  }

  setResponse(index: number, value: string) {
    this.responses[this.moduleTitle] = {
      ...(this.responses[this.moduleTitle] ?? {}),
      [index]: value
    };
    this.saveResponses();
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
    this.saveResponses();
  }

  isMultiSelected(index: number, option: string) {
    const current = this.responses[this.moduleTitle]?.[index];
    return Array.isArray(current) && current.includes(option);
  }
}
