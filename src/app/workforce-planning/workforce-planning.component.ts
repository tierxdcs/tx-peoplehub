import { Component } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-workforce-planning',
  standalone: true,
  imports: [RouterLink, FormsModule, DatePipe],
  templateUrl: './workforce-planning.component.html',
  styleUrl: './workforce-planning.component.scss'
})
export class WorkforcePlanningComponent {
  private readonly storageKey = 'tx-peoplehub-workforce-requests';
  status = '';
  requests: {
    title: string;
    department: string;
    location: string;
    headcount: number;
    level: string;
    hireType: string;
    startDate: string;
    justification: string;
    budgetImpact: string;
    manager: string;
    approval: string;
    submittedAt: string;
  }[] = [];
  form = {
    title: '',
    department: 'Operations',
    location: 'Austin, TX',
    headcount: 1,
    level: 'Mid',
    hireType: 'Full-time',
    startDate: '',
    justification: '',
    budgetImpact: '',
    manager: ''
  };

  ngOnInit() {
    const stored = localStorage.getItem(this.storageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as typeof this.requests;
        if (Array.isArray(parsed)) {
          this.requests = parsed;
        }
      } catch {
        localStorage.removeItem(this.storageKey);
      }
    }

    const adminRaw = localStorage.getItem('tx-peoplehub-admin-draft');
    if (!adminRaw) {
      return;
    }
    try {
      const parsed = JSON.parse(adminRaw) as { manager?: string; department?: string };
      if (parsed.manager) {
        this.form.manager = parsed.manager;
      }
      if (parsed.department) {
        this.form.department = parsed.department;
      }
    } catch {
      localStorage.removeItem('tx-peoplehub-admin-draft');
    }
  }

  submitRequest() {
    if (!this.form.title || !this.form.startDate || !this.form.justification) {
      this.status = 'Please complete the role title, start date, and justification.';
      return;
    }
    const request = {
      title: this.form.title.trim(),
      department: this.form.department,
      location: this.form.location.trim(),
      headcount: Number(this.form.headcount) || 1,
      level: this.form.level,
      hireType: this.form.hireType,
      startDate: this.form.startDate,
      justification: this.form.justification.trim(),
      budgetImpact: this.form.budgetImpact.trim(),
      manager: this.form.manager || 'Direct Manager',
      approval: 'Pending CFO & CEO approval',
      submittedAt: new Date().toISOString()
    };
    this.requests = [request, ...this.requests];
    localStorage.setItem(this.storageKey, JSON.stringify(this.requests));
    this.status = 'Request submitted to CFO and CEO for approval.';
    this.form = {
      title: '',
      department: this.form.department,
      location: 'Austin, TX',
      headcount: 1,
      level: 'Mid',
      hireType: 'Full-time',
      startDate: '',
      justification: '',
      budgetImpact: '',
      manager: this.form.manager
    };
  }
}
