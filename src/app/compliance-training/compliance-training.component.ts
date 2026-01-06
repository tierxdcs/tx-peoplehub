import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-compliance-training',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './compliance-training.component.html',
  styleUrl: './compliance-training.component.scss'
})
export class ComplianceTrainingComponent {
  private readonly assignmentsKey = 'tx-peoplehub-assigned-training';
  private readonly adminKey = 'tx-peoplehub-admin-draft';
  private readonly responsesKey = 'tx-peoplehub-training-responses';
  trainings: {
    title: string;
    status: string;
    due: string;
    questions: { text: string; type: string }[];
  }[] = [];
  responses: Record<string, Record<number, string | string[]>> = {};
  expandedIndex: number | null = null;
  readonly options = ['Option A', 'Option B', 'Option C'];
  readonly trueFalseOptions = ['True', 'False'];
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
    this.loadResponses();
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
            due: assignment.dueDate,
            questions: assignment.questions ?? []
          }));
      }
    } catch {
      localStorage.removeItem(this.assignmentsKey);
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

  toggleModule(index: number) {
    this.expandedIndex = this.expandedIndex === index ? null : index;
  }

  setResponse(moduleTitle: string, index: number, value: string) {
    this.responses[moduleTitle] = {
      ...(this.responses[moduleTitle] ?? {}),
      [index]: value
    };
    this.saveResponses();
  }

  getSingleResponse(moduleTitle: string, index: number) {
    const response = this.responses[moduleTitle]?.[index];
    return typeof response === 'string' ? response : '';
  }

  toggleMultiResponse(moduleTitle: string, index: number, option: string) {
    const current = this.responses[moduleTitle]?.[index];
    const next = Array.isArray(current) ? [...current] : [];
    const exists = next.includes(option);
    const updated = exists ? next.filter((value) => value !== option) : [...next, option];
    this.responses[moduleTitle] = {
      ...(this.responses[moduleTitle] ?? {}),
      [index]: updated
    };
    this.saveResponses();
  }

  isMultiSelected(moduleTitle: string, index: number, option: string) {
    const current = this.responses[moduleTitle]?.[index];
    return Array.isArray(current) && current.includes(option);
  }
}
