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
      { text: '', type: 'Multiple choice', options: ['Option A', 'Option B', 'Option C'] }
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
          options: this.normalizeOptions(question.type, question.options)
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
        return (
          this.form.department === 'All departments' ||
          user.department === this.form.department
        );
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
        options: this.normalizeOptions(question.type, question.options)
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
          { text: '', type: 'Multiple choice', options: ['Option A', 'Option B', 'Option C'] }
        ]
      };
    } catch {
      this.status = 'Unable to assign training.';
    }
  }

  addQuestion() {
    this.form.questions = [
      ...this.form.questions,
      { text: '', type: 'Multiple choice', options: ['Option A', 'Option B', 'Option C'] }
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
      { text: '', type: 'Multiple choice', options: ['Option A', 'Option B', 'Option C'] }
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
    question: { text: string; type: string; options?: string[] },
    save = false
  ) {
    question.options = this.normalizeOptions(question.type, question.options);
    if (save) {
      const index = this.assignments.findIndex((assignment) =>
        assignment.questions.includes(question)
      );
      if (index >= 0) {
        this.saveAssignment(index);
      }
    }
  }

  addOption(question: { text: string; type: string; options?: string[] }, save = false) {
    question.options = [...(question.options ?? []), ''];
    if (save) {
      const index = this.assignments.findIndex((assignment) =>
        assignment.questions.includes(question)
      );
      if (index >= 0) {
        this.saveAssignment(index);
      }
    }
  }

  removeOption(question: { text: string; type: string; options?: string[] }, index: number, save = false) {
    question.options = (question.options ?? []).filter((_, i) => i !== index);
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
    question: { text: string; type: string; options?: string[] },
    index: number,
    value: string,
    save = false
  ) {
    question.options = (question.options ?? []).map((option, i) => (i === index ? value : option));
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
