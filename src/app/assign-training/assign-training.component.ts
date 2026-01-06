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
    const stored = localStorage.getItem(this.storageKey);
    const existing = stored ? (JSON.parse(stored) as {
      title: string;
      audience: string;
      dueDate: string;
      progress: number;
    }[]) : [];
    const newAssignment = {
      title: this.form.title,
      audience: this.form.audience,
      dueDate: this.form.dueDate,
      progress: 0
    };
    localStorage.setItem(
      this.storageKey,
      JSON.stringify([newAssignment, ...existing])
    );

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
}
