import { Component } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService, DepartmentRecord, RequisitionRecord } from '../services/api.service';

@Component({
  selector: 'app-workforce-planning',
  standalone: true,
  imports: [RouterLink, FormsModule, DatePipe],
  templateUrl: './workforce-planning.component.html',
  styleUrl: './workforce-planning.component.scss'
})
export class WorkforcePlanningComponent {
  status = '';
  sessionEmail = '';
  sessionDepartment = 'Operations';
  showSuccessModal = false;
  departments: DepartmentRecord[] = [];
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
    location: '',
    headcount: 1,
    level: 'Mid',
    hireType: 'Full-time',
    startDate: '',
    justification: '',
    budgetImpact: '',
    manager: '',
    costCenter: ''
  };
  managerOptions: string[] = [];
  readonly locationOptions = [
    'Bengaluru',
    'Chennai',
    'Delhi',
    'Mumbai',
    'Hyderabad',
    'Pune',
    'Kolkata',
    'Ahmedabad',
    'Jaipur',
    'Surat',
    'Lucknow',
    'Noida',
    'Gurugram',
    'Indore',
    'Kochi',
    'Coimbatore',
    'Nagpur',
    'Bhopal',
    'Vadodara',
    'Visakhapatnam'
  ];

  constructor(private readonly api: ApiService) {}

  async ngOnInit() {
    this.loadSession();
    await Promise.all([this.loadRequests(), this.loadDepartments(), this.loadManagers()]);
  }

  loadSession() {
    const raw = localStorage.getItem('tx-peoplehub-session');
    if (!raw) {
      return;
    }
    try {
      const parsed = JSON.parse(raw) as { email?: string; department?: string };
      this.sessionEmail = parsed.email?.trim().toLowerCase() || '';
      this.sessionDepartment = parsed.department?.trim() || this.sessionDepartment;
      if (this.sessionDepartment) {
        this.form.department = this.sessionDepartment;
      }
      if (!this.form.location) {
        this.form.location = 'Bengaluru';
      }
    } catch {
      this.sessionEmail = '';
    }
  }

  async loadRequests() {
    try {
      this.requests = await firstValueFrom(
        this.api.getRequisitions(this.sessionEmail || undefined)
      );
    } catch {
      this.requests = [];
    }
  }

  async loadDepartments() {
    try {
      this.departments = await firstValueFrom(this.api.getDepartments());
      if (!this.form.department) {
        const match = this.departments.find(
          (dept) => dept.name === this.sessionDepartment
        );
        this.form.department = match?.name ?? this.departments[0]?.name ?? 'Operations';
      }
      if (!this.form.location) {
        this.form.location = 'Bengaluru';
      }
    } catch {
      this.departments = [];
      if (!this.form.department) {
        this.form.department = this.sessionDepartment || 'Operations';
      }
      if (!this.form.location) {
        this.form.location = 'Bengaluru';
      }
    }
  }

  async loadManagers() {
    try {
      const users = await firstValueFrom(this.api.getUsers());
      this.managerOptions = users
        .filter((user) => user.director === 'Yes')
        .map((user) => user.fullName)
        .filter(Boolean);
      if (!this.form.manager && this.managerOptions.length) {
        this.form.manager = this.managerOptions[0];
      }
    } catch {
      this.managerOptions = [];
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
      approval: 'Pending Board Directors approval',
      requesterEmail: this.sessionEmail
    };
    firstValueFrom(this.api.createRequisition(request))
      .then((saved) => {
        this.requests = [saved, ...this.requests];
        this.status = 'Request submitted to Board Directors for approval.';
        this.showSuccessModal = true;
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

  closeSuccessModal() {
    this.showSuccessModal = false;
  }
}
