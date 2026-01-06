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
