import { Component } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink, FormsModule, DatePipe],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss'
})
export class HomeComponent {
  isBalanceOpen = false;
  isIdeasOpen = false;
  ideaStatus = '';
  managerName = 'Direct Manager';
  ideaHistory: {
    title: string;
    type: string;
    summary: string;
    manager: string;
    submittedAt: string;
  }[] = [];
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
  private readonly ideasKey = 'tx-peoplehub-ideas';

  ngOnInit() {
    const raw = localStorage.getItem('tx-peoplehub-admin-draft');
    if (!raw) {
      const storedRequests = localStorage.getItem('tx-peoplehub-leave-requests');
      if (storedRequests) {
        try {
          const parsed = JSON.parse(storedRequests) as typeof this.pendingRequests;
          if (Array.isArray(parsed)) {
            this.pendingRequests = parsed;
          }
        } catch {
          localStorage.removeItem('tx-peoplehub-leave-requests');
        }
      }
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

    const storedIdeas = localStorage.getItem(this.ideasKey);
    if (!storedIdeas) {
      return;
    }
    try {
      const parsed = JSON.parse(storedIdeas) as typeof this.ideaHistory;
      if (Array.isArray(parsed)) {
        this.ideaHistory = parsed;
      }
    } catch {
      localStorage.removeItem(this.ideasKey);
    }

    const storedRequests = localStorage.getItem('tx-peoplehub-leave-requests');
    if (!storedRequests) {
      return;
    }
    try {
      const parsed = JSON.parse(storedRequests) as typeof this.pendingRequests;
      if (Array.isArray(parsed)) {
        this.pendingRequests = parsed;
      }
    } catch {
      localStorage.removeItem('tx-peoplehub-leave-requests');
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
    const idea = {
      title: this.ideaForm.title.trim(),
      type: this.ideaForm.type,
      summary: this.ideaForm.summary.trim(),
      manager: this.managerName,
      submittedAt: new Date().toISOString()
    };
    this.ideaHistory = [idea, ...this.ideaHistory];
    localStorage.setItem(this.ideasKey, JSON.stringify(this.ideaHistory));
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
    const confirmed = window.confirm(
      'Submit this leave request for manager approval?'
    );
    if (!confirmed) {
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
    localStorage.setItem(
      'tx-peoplehub-leave-requests',
      JSON.stringify(this.pendingRequests)
    );

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
    localStorage.setItem(
      'tx-peoplehub-leave-requests',
      JSON.stringify(this.pendingRequests)
    );
  }
}
