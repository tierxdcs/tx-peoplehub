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
  isIdeasOpen = false;
  ideaStatus = '';
  managerName = 'Direct Manager';
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
  ideaForm = {
    title: '',
    type: 'Product',
    summary: '',
    manager: ''
  };
  leaveError = '';

  ngOnInit() {
    const raw = localStorage.getItem('tx-peoplehub-admin-draft');
    if (!raw) {
      return;
    }
    try {
      const parsed = JSON.parse(raw) as { manager?: string };
      if (parsed.manager) {
        this.managerName = parsed.manager;
      }
    } catch {
      localStorage.removeItem('tx-peoplehub-admin-draft');
    }
  }

  openBalances() {
    this.isBalanceOpen = true;
  }

  closeBalances() {
    this.isBalanceOpen = false;
  }

  openIdeas() {
    this.isIdeasOpen = true;
    this.ideaForm.manager = this.managerName;
  }

  closeIdeas() {
    this.isIdeasOpen = false;
    this.ideaStatus = '';
  }

  submitIdea() {
    if (!this.ideaForm.title || !this.ideaForm.summary) {
      this.ideaStatus = 'Add a title and summary before submitting.';
      return;
    }
    this.ideaStatus = `Idea sent to ${this.managerName}.`;
    this.ideaForm = {
      title: '',
      type: 'Product',
      summary: '',
      manager: this.managerName
    };
  }

  submitLeave() {
    if (!this.leaveForm.startDate || !this.leaveForm.endDate) {
      this.leaveError = 'Select start and end dates.';
      return;
    }
    if (this.leaveForm.endDate < this.leaveForm.startDate) {
      this.leaveError = 'End date must be after the start date.';
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
    const confirmed = window.confirm(
      'Cancel this leave request? This cannot be undone.'
    );
    if (!confirmed) {
      return;
    }
    this.pendingRequests = this.pendingRequests.filter((_, i) => i !== index);
  }
}
