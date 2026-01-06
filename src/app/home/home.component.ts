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
  isBalanceOpen = false;
  pendingRequests = [
    { type: 'PTO', range: 'Feb 12 - Feb 14', status: 'Pending' },
    { type: 'Sick', range: 'Jan 22', status: 'Pending' }
  ];
  leaveForm = {
    type: 'PTO',
    startDate: '',
    endDate: '',
    notes: ''
  };
  leaveError = '';

  openBalances() {
    this.isBalanceOpen = true;
  }

  closeBalances() {
    this.isBalanceOpen = false;
  }

  submitLeave() {
    if (!this.leaveForm.startDate || !this.leaveForm.endDate) {
      this.leaveError = 'Select start and end dates.';
      return;
    }

    const format = (value: string) => {
      const date = new Date(value);
      return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric'
      });
    };

    const range =
      this.leaveForm.startDate === this.leaveForm.endDate
        ? format(this.leaveForm.startDate)
        : `${format(this.leaveForm.startDate)} - ${format(this.leaveForm.endDate)}`;

    this.pendingRequests = [
      {
        type: this.leaveForm.type,
        range,
        status: 'Pending'
      },
      ...this.pendingRequests
    ];

    this.leaveError = '';
    this.leaveForm = { type: 'PTO', startDate: '', endDate: '', notes: '' };
  }

  cancelRequest(index: number) {
    this.pendingRequests = this.pendingRequests.filter((_, i) => i !== index);
  }
}
