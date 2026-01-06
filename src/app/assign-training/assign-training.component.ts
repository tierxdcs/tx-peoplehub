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
  private readonly storageKey = 'tx-peoplehub-assigned-training';
  form = {
    title: '',
    audience: 'All employees',
    dueDate: '',
    questions: [
      { text: '', type: 'Multiple choice' }
    ]
  };
  status = '';
  assignments: {
    title: string;
    audience: string;
    dueDate: string;
    completed: number;
    total: number;
    questions: { text: string; type: string }[];
    participants: { name: string; status: 'Completed' | 'Pending' }[];
  }[] = [];
  expandedIndex: number | null = null;

  ngOnInit() {
    const stored = localStorage.getItem(this.storageKey);
    if (!stored) {
      return;
    }
    try {
      const parsed = JSON.parse(stored) as {
        title: string;
        audience: string;
        dueDate: string;
        completed: number;
        total: number;
        questions?: { text: string; type: string }[];
        participants?: { name: string; status: 'Completed' | 'Pending' }[];
      }[];
      if (Array.isArray(parsed)) {
        this.assignments = parsed.map((item) => ({
          ...item,
          questions: item.questions ?? [],
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
      dueDate: this.form.dueDate,
      completed: 0,
      total: 12,
      questions: this.form.questions.map((question) => ({
        text: question.text.trim(),
        type: question.type
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
      dueDate: '',
      questions: [{ text: '', type: 'Multiple choice' }]
    };
  }

  addQuestion() {
    this.form.questions = [
      ...this.form.questions,
      { text: '', type: 'Multiple choice' }
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
      { text: '', type: 'Multiple choice' }
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
