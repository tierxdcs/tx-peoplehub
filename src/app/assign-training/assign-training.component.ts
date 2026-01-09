import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService, DepartmentRecord, TrainingAssignment, UserRecord } from '../services/api.service';

@Component({
  selector: 'app-assign-training',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './assign-training.component.html',
  styleUrl: './assign-training.component.scss'
})
export class AssignTrainingComponent {
  departments: DepartmentRecord[] = [];
  users: UserRecord[] = [];
  form = {
    title: '',
    audience: 'All employees',
    department: 'All departments',
    dueDate: '',
    questions: [
      {
        text: '',
        type: 'Multiple choice',
        options: ['Option A', 'Option B', 'Option C'],
        correctAnswers: ['Option A']
      }
    ]
  };
  status = '';
  assignments: TrainingAssignment[] = [];
  expandedIndex: number | null = null;

  constructor(private readonly api: ApiService) {}

  async ngOnInit() {
    await Promise.all([this.loadDepartments(), this.loadUsers(), this.loadAssignments()]);
    if (this.departments.length && this.form.department === 'All departments') {
      this.form.department = this.departments[0].name;
    }
  }

  async loadDepartments() {
    try {
      this.departments = await firstValueFrom(this.api.getDepartments());
    } catch {
      this.departments = [];
    }
  }

  async loadUsers() {
    try {
      this.users = await firstValueFrom(this.api.getUsers());
    } catch {
      this.users = [];
    }
  }

  async loadAssignments() {
    try {
      const assignments = await firstValueFrom(this.api.getTrainingAssignments());
      this.assignments = assignments.map((item) => ({
        ...item,
        department: item.department ?? 'All departments',
        questions: (item.questions ?? []).map((question) => ({
          text: question.text,
          type: question.type,
          options: this.normalizeOptions(question.type, question.options),
          correctAnswers: this.normalizeCorrectAnswers(question)
        })),
        participants: (item.participants ?? []).map((participant) => ({
          name: participant.name,
          status: participant.status === 'Completed' ? 'Completed' : 'Pending'
        }))
      }));
    } catch {
      this.assignments = [];
    }
  }

  async assign() {
    if (!this.form.title || !this.form.dueDate) {
      this.status = 'Please provide a title and due date.';
      return;
    }
    const hasQuestion = this.form.questions.some((q) => q.text.trim());
    if (!hasQuestion) {
      this.status = 'Add at least one training question.';
      return;
    }
    const participants = this.users
      .filter((user) => user.status === 'Active')
      .filter((user) => {
        const departmentMatch =
          this.form.department === 'All departments' ||
          user.department === this.form.department;
        const audienceMatch =
          this.form.audience === 'All employees' || user.role === this.form.audience;
        return departmentMatch && audienceMatch;
      })
      .map((user) => ({ name: user.fullName, status: 'Pending' as const }));

    const newAssignment = {
      title: this.form.title,
      audience: this.form.audience,
      department: this.form.department,
      dueDate: this.form.dueDate,
      completed: 0,
      total: participants.length,
      questions: this.form.questions.map((question) => ({
        text: question.text.trim(),
        type: question.type,
        options: this.normalizeOptions(question.type, question.options),
        correctAnswers: this.normalizeCorrectAnswers(question)
      })),
      participants
    };
    try {
      const saved = await firstValueFrom(this.api.createTrainingAssignment(newAssignment));
      this.assignments = [saved, ...this.assignments];
      this.status = 'Training assigned.';
    this.form = {
      title: '',
      audience: 'All employees',
      department: this.departments[0]?.name ?? 'All departments',
      dueDate: '',
      questions: [
        {
          text: '',
          type: 'Multiple choice',
          options: ['Option A', 'Option B', 'Option C'],
          correctAnswers: ['Option A']
        }
      ]
    };
    } catch {
      this.status = 'Unable to assign training.';
    }
  }

  addQuestion() {
    this.form.questions = [
      ...this.form.questions,
      {
        text: '',
        type: 'Multiple choice',
        options: ['Option A', 'Option B', 'Option C'],
        correctAnswers: ['Option A']
      }
    ];
  }

  removeQuestion(index: number) {
    this.form.questions = this.form.questions.filter((_, i) => i !== index);
  }

  toggleAssignment(index: number) {
    this.expandedIndex = this.expandedIndex === index ? null : index;
  }

  addAssignmentQuestion(index: number) {
    const assignment = this.assignments[index];
    if (!assignment) {
      return;
    }
    assignment.questions = [
      ...assignment.questions,
      {
        text: '',
        type: 'Multiple choice',
        options: ['Option A', 'Option B', 'Option C'],
        correctAnswers: ['Option A']
      }
    ];
    this.saveAssignment(index);
  }

  removeAssignmentQuestion(assignmentIndex: number, questionIndex: number) {
    const assignment = this.assignments[assignmentIndex];
    if (!assignment) {
      return;
    }
    const confirmed = window.confirm(
      'Delete this question? This cannot be undone.'
    );
    if (!confirmed) {
      return;
    }
    assignment.questions = assignment.questions.filter((_, i) => i !== questionIndex);
    this.saveAssignment(assignmentIndex);
  }

  saveAssignment(index: number) {
    const assignment = this.assignments[index];
    if (!assignment) {
      return;
    }
    firstValueFrom(
      this.api.updateTrainingAssignment(assignment.id, {
        questions: assignment.questions,
        participants: assignment.participants,
        completed: assignment.completed,
        total: assignment.total
      })
    ).catch(() => {
      return;
    });
  }

  onQuestionTypeChange(
    question: { text: string; type: string; options?: string[]; correctAnswers?: string[]; correctAnswer?: string },
    save = false
  ) {
    question.options = this.normalizeOptions(question.type, question.options);
    question.correctAnswers = this.normalizeCorrectAnswers(question);
    if (save) {
      const index = this.assignments.findIndex((assignment) =>
        assignment.questions.includes(question)
      );
      if (index >= 0) {
        this.saveAssignment(index);
      }
    }
  }

  addOption(
    question: { text: string; type: string; options?: string[]; correctAnswers?: string[]; correctAnswer?: string },
    save = false
  ) {
    question.options = [...(question.options ?? []), ''];
    question.correctAnswers = this.normalizeCorrectAnswers(question);
    if (save) {
      const index = this.assignments.findIndex((assignment) =>
        assignment.questions.includes(question)
      );
      if (index >= 0) {
        this.saveAssignment(index);
      }
    }
  }

  removeOption(
    question: { text: string; type: string; options?: string[]; correctAnswers?: string[]; correctAnswer?: string },
    index: number,
    save = false
  ) {
    question.options = (question.options ?? []).filter((_, i) => i !== index);
    question.correctAnswers = this.normalizeCorrectAnswers(question);
    if (save) {
      const assignmentIndex = this.assignments.findIndex((assignment) =>
        assignment.questions.includes(question)
      );
      if (assignmentIndex >= 0) {
        this.saveAssignment(assignmentIndex);
      }
    }
  }

  updateOption(
    question: { text: string; type: string; options?: string[]; correctAnswers?: string[]; correctAnswer?: string },
    index: number,
    value: string,
    save = false
  ) {
    question.options = (question.options ?? []).map((option, i) => (i === index ? value : option));
    question.correctAnswers = this.normalizeCorrectAnswers(question);
    if (save) {
      const assignmentIndex = this.assignments.findIndex((assignment) =>
        assignment.questions.includes(question)
      );
      if (assignmentIndex >= 0) {
        this.saveAssignment(assignmentIndex);
      }
    }
  }

  normalizeOptions(type: string, options?: string[]) {
    if (type === 'Short answer') {
      return [];
    }
    if (type === 'True/False') {
      return ['True', 'False'];
    }
    return options?.length ? options : ['Option A', 'Option B', 'Option C'];
  }

  normalizeCorrectAnswers(question: {
    type: string;
    options?: string[];
    correctAnswers?: string[];
    correctAnswer?: string;
  }) {
    if (question.type === 'Short answer') {
      if (question.correctAnswers?.length) {
        return question.correctAnswers;
      }
      if (question.correctAnswer) {
        return [question.correctAnswer];
      }
      return [''];
    }
    const options = this.normalizeOptions(question.type, question.options);
    if (!options.length) {
      return [];
    }
    const existing =
      question.correctAnswers ??
      (question.correctAnswer ? [question.correctAnswer] : []);
    const filtered = existing.filter((value) => options.includes(value));
    if (filtered.length) {
      return filtered;
    }
    return [options[0]];
  }

  getSingleCorrectAnswer(question: { correctAnswers?: string[] }) {
    return question.correctAnswers?.[0] ?? '';
  }

  setSingleCorrectAnswer(
    question: { correctAnswers?: string[] },
    value: string,
    assignmentIndex?: number
  ) {
    question.correctAnswers = [value];
    if (assignmentIndex !== undefined) {
      this.saveAssignment(assignmentIndex);
    }
  }

  toggleCorrectAnswer(
    question: { type: string; correctAnswers?: string[] },
    option: string,
    assignmentIndex?: number
  ) {
    const current = question.correctAnswers ?? [];
    const exists = current.includes(option);
    question.correctAnswers = exists
      ? current.filter((value) => value !== option)
      : [...current, option];
    if (!question.correctAnswers.length) {
      question.correctAnswers = [option];
    }
    if (assignmentIndex !== undefined) {
      this.saveAssignment(assignmentIndex);
    }
  }

  countStatus(
    assignment: {
      participants: { name: string; status: 'Completed' | 'Pending' }[];
    },
    status: 'Completed' | 'Pending'
  ) {
    return assignment.participants.filter((participant) => participant.status === status)
      .length;
  }
}
