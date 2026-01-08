import { Component } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService, RequisitionRecord } from '../services/api.service';

@Component({
  selector: 'app-workforce-planning',
  standalone: true,
  imports: [RouterLink, FormsModule, DatePipe],
  templateUrl: './workforce-planning.component.html',
  styleUrl: './workforce-planning.component.scss'
})
export class WorkforcePlanningComponent {
  status = '';
  requests: {
    id: string;
    title: string;
    department: string;
    location: string;
    headcount: number;
    level: string;
    hireType: string;
    startDate: string;
    justification: string;
    budgetImpact: string;
    costCenter: string;
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
    manager: '',
    costCenter: ''
  };

  constructor(private readonly api: ApiService) {}

  async ngOnInit() {
    await Promise.all([this.loadRequests(), this.loadProfile()]);
  }

  async loadRequests() {
    try {
      this.requests = await firstValueFrom(this.api.getRequisitions());
    } catch {
      this.requests = [];
    }
  }

  async loadProfile() {
    try {
      const profile = await firstValueFrom(this.api.getEmployeeProfile());
      if (profile?.manager) {
        this.form.manager = profile.manager;
      }
      if (profile?.department) {
        this.form.department = profile.department;
      }
    } catch {
      return;
    }
  }

  submitRequest() {
    if (!this.form.title || !this.form.startDate || !this.form.justification) {
      this.status = 'Please complete the role title, start date, and justification.';
      return;
    }
    const request: Omit<RequisitionRecord, 'id' | 'submittedAt'> = {
      title: this.form.title.trim(),
      department: this.form.department,
      location: this.form.location.trim(),
      headcount: Number(this.form.headcount) || 1,
      level: this.form.level,
      hireType: this.form.hireType,
      startDate: this.form.startDate,
      justification: this.form.justification.trim(),
      budgetImpact: this.form.budgetImpact.trim(),
      costCenter: this.form.costCenter.trim(),
      manager: this.form.manager || 'Direct Manager',
      approval: 'Pending Board Directors approval'
    };
    firstValueFrom(this.api.createRequisition(request))
      .then((saved) => {
        this.requests = [saved, ...this.requests];
        this.status = 'Request submitted to Board Directors for approval.';
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
          manager: this.form.manager,
          costCenter: ''
        };
      })
      .catch(() => {
        this.status = 'Unable to submit requisition.';
      });
  }
}
