import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss'
})
export class HomeComponent {
  leaveForm = {
    type: 'PTO',
    startDate: '',
    endDate: '',
    notes: ''
  };
  leaveStatus = '';

  submitLeave() {
    if (!this.leaveForm.startDate || !this.leaveForm.endDate) {
      this.leaveStatus = 'Please select start and end dates.';
      return;
    }

    this.leaveStatus = 'Pending manager approval';
  }
}
