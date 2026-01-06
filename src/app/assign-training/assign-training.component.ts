import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-assign-training',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './assign-training.component.html',
  styleUrl: './assign-training.component.scss'
})
export class AssignTrainingComponent {
  private readonly departmentsKey = 'tx-peoplehub-departments';
  private readonly storageKey = 'tx-peoplehub-assigned-training';
  departments: { name: string; head: string }[] = [];
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
  assignments: {
    title: string;
    audience: string;
    department: string;
    dueDate: string;
    completed: number;
    total: number;
    questions: { text: string; type: string; options: string[] }[];
    participants: { name: string; status: 'Completed' | 'Pending' }[];
  }[] = [];
  expandedIndex: number | null = null;

  ngOnInit() {
    const storedDepartments = localStorage.getItem(this.departmentsKey);
    if (storedDepartments) {
      try {
        const parsed = JSON.parse(storedDepartments) as {
          name: string;
          head: string;
        }[];
        if (Array.isArray(parsed)) {
          this.departments = parsed;
          if (parsed.length && this.form.department === 'All departments') {
            this.form.department = parsed[0].name;
          }
        }
      } catch {
        localStorage.removeItem(this.departmentsKey);
      }
    }

    const stored = localStorage.getItem(this.storageKey);
    if (!stored) {
      return;
    }
    try {
      const parsed = JSON.parse(stored) as {
        title: string;
        audience: string;
        department?: string;
        dueDate: string;
        completed: number;
        total: number;
        questions?: { text: string; type: string; options?: string[] }[];
        participants?: { name: string; status: 'Completed' | 'Pending' }[];
      }[];
      if (Array.isArray(parsed)) {
        this.assignments = parsed.map((item) => ({
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
      }
    } catch {
      localStorage.removeItem(this.storageKey);
    }
  }

  assign() {
    if (!this.form.title || !this.form.dueDate) {
      this.status = 'Please provide a title and due date.';
      return;
    }
    const hasQuestion = this.form.questions.some((q) => q.text.trim());
    if (!hasQuestion) {
      this.status = 'Add at least one training question.';
      return;
    }
    const newAssignment = {
      title: this.form.title,
      audience: this.form.audience,
      department: this.form.department,
      dueDate: this.form.dueDate,
      completed: 0,
      total: 12,
      questions: this.form.questions.map((question) => ({
        text: question.text.trim(),
        type: question.type,
        options: this.normalizeOptions(question.type, question.options)
      })),
      participants: [
        { name: 'Nithin Gangadhar', status: 'Completed' as const },
        { name: 'Jessie Moore', status: 'Pending' as const },
        { name: 'Iman Shah', status: 'Pending' as const },
        { name: 'Ravi Patel', status: 'Completed' as const }
      ]
    };
    this.assignments = [newAssignment, ...this.assignments];
    this.saveAssignments();

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
    this.saveAssignments();
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
    this.saveAssignments();
  }

  saveAssignments() {
    localStorage.setItem(this.storageKey, JSON.stringify(this.assignments));
  }

  onQuestionTypeChange(question: { type: string; options: string[] }, save = false) {
    question.options = this.normalizeOptions(question.type, question.options);
    if (save) {
      this.saveAssignments();
    }
  }

  addOption(question: { options: string[] }, save = false) {
    question.options = [...question.options, ''];
    if (save) {
      this.saveAssignments();
    }
  }

  removeOption(question: { options: string[] }, index: number, save = false) {
    question.options = question.options.filter((_, i) => i !== index);
    if (save) {
      this.saveAssignments();
    }
  }

  updateOption(question: { options: string[] }, index: number, value: string, save = false) {
    question.options = question.options.map((option, i) => (i === index ? value : option));
    if (save) {
      this.saveAssignments();
    }
  }

  normalizeOptions(type: string, options?: string[]) {
    if (type === 'Short answer') {
      return [];
    }
    if (type === 'True/False') {
      return options?.length ? options : ['True', 'False'];
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
