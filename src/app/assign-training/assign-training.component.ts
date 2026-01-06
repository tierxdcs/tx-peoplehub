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
    notes: ''
  };
  status = '';

  assign() {
    if (!this.form.title || !this.form.dueDate) {
      this.status = 'Please provide a title and due date.';
      return;
    }
    this.status = 'Training assigned.';
    this.form = { title: '', audience: 'All employees', dueDate: '', notes: '' };
  }
}
