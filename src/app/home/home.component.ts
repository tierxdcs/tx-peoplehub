import { Component } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService, EmployeeProfile, IdeaRecord, LeaveRecord } from '../services/api.service';

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
  activeUserCount = 0;
  spotlightScore: number | null = null;
  spotlightProgress = 0;
  spotlightPercent: number | null = null;
  spotlightPhoto = 'assets/people/default-avatar.svg';
  todayTasks: { title: string; createdAt?: string }[] = [];
  pendingApprovalsCount = 0;
  complianceCoverage = 0;
  trainingsCompleted = 0;
  trainingsAssigned = 0;
  pendingReimbursements = 0;
  ideaHistory: IdeaRecord[] = [];
  pendingRequests: { id: string; type: string; range: string; status: string; employee?: string }[] = [];
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
  currentProfile: EmployeeProfile | null = null;
  sessionEmail = '';
  sessionName = '';
  sessionRole = '';
  sessionDepartment = '';
  isDirector = false;

  constructor(private readonly api: ApiService) {}

  async ngOnInit() {
    this.loadSession();
    await this.refreshDirectorStatus();
    await this.loadDashboard();
  }

  loadSession() {
    const raw = localStorage.getItem('tx-peoplehub-session');
    if (!raw) {
      return;
    }
    try {
      const parsed = JSON.parse(raw) as {
        email?: string;
        name?: string;
        director?: string;
        role?: string;
        department?: string;
      };
      this.sessionEmail = parsed.email?.trim().toLowerCase() || '';
      this.sessionName = parsed.name?.trim() || '';
      this.sessionRole = parsed.role?.trim() || '';
      this.sessionDepartment = parsed.department?.trim() || '';
      this.isDirector = parsed.director?.trim().toLowerCase() === 'yes';
    } catch {
      this.sessionEmail = '';
      this.sessionName = '';
      this.sessionRole = '';
      this.sessionDepartment = '';
      this.isDirector = false;
    }
  }

  async refreshDirectorStatus() {
    if (!this.sessionEmail) {
      this.isDirector = false;
      return;
    }
    try {
      const users = await firstValueFrom(
        this.api.getUsers({ search: this.sessionEmail, limit: 5 })
      );
      const match = users.find(
        (user) => user.email?.trim().toLowerCase() === this.sessionEmail
      );
      if (!match) {
        return;
      }
      const isDirector = match.director?.trim().toLowerCase() === 'yes';
      this.isDirector = isDirector;
      const raw = localStorage.getItem('tx-peoplehub-session');
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { director?: string };
          parsed.director = isDirector ? 'Yes' : 'No';
          localStorage.setItem('tx-peoplehub-session', JSON.stringify(parsed));
        } catch {
          return;
        }
      }
    } catch {
      return;
    }
  }

  async loadDashboard() {
    if (!this.sessionEmail) {
      this.currentProfile = null;
      this.activeUserCount = 0;
      this.spotlightScore = null;
      this.spotlightPercent = null;
      this.spotlightProgress = 0;
      this.spotlightPhoto = 'assets/people/default-avatar.svg';
      this.todayTasks = [];
      this.pendingApprovalsCount = 0;
      this.pendingRequests = [];
      this.ideaHistory = [];
      this.pendingReimbursements = 0;
      this.trainingsCompleted = 0;
      this.complianceCoverage = 0;
      this.trainingsAssigned = 0;
      return;
    }
    try {
      const payload = await firstValueFrom(
        this.api.getHomeDashboardLight(this.sessionEmail)
      );
      this.applyDashboardPayload(payload);
      void this.loadDashboardDetails();
    } catch {
      this.currentProfile = null;
      this.activeUserCount = 0;
      this.spotlightScore = null;
      this.spotlightProgress = 0;
      this.spotlightPhoto = 'assets/people/default-avatar.svg';
      this.todayTasks = [];
      this.pendingApprovalsCount = 0;
      this.pendingRequests = [];
      this.ideaHistory = [];
      this.pendingReimbursements = 0;
      this.trainingsCompleted = 0;
      this.complianceCoverage = 0;
      this.trainingsAssigned = 0;
    }
  }

  async loadDashboardDetails() {
    try {
      const payload = await firstValueFrom(
        this.api.getHomeDashboard(this.sessionEmail || undefined)
      );
      this.applyDashboardPayload(payload);
      if (this.sessionEmail) {
        const profile = await firstValueFrom(
          this.api.getEmployeeProfile({ email: this.sessionEmail, fresh: true })
        );
        if (profile) {
          this.currentProfile = profile;
          this.spotlightPhoto = profile.photoUrl || 'assets/people/default-avatar.svg';
        }
      }
      await this.refreshComplianceCoverage();
      await this.refreshPendingReimbursements();
    } catch {
      return;
    }
  }

  async refreshPendingReimbursements() {
    if (!this.sessionEmail) {
      this.pendingReimbursements = 0;
      return;
    }
    try {
      const reimbursements = await firstValueFrom(
        this.api.getReimbursements({ employeeEmail: this.sessionEmail })
      );
      this.pendingReimbursements = reimbursements.filter((claim) =>
        String(claim.status ?? '').toLowerCase().startsWith('pending')
      ).length;
    } catch {
      this.pendingReimbursements = 0;
    }
  }

  private applyDashboardPayload(payload: {
    activeUserCount: number;
    profile: EmployeeProfile | null;
    tasks: { title: string; createdAt?: string }[];
    pendingLeaves: LeaveRecord[];
    ideas: IdeaRecord[];
    reimbursements: { pending: number };
    training: { completed: number; total: number; coverage: number };
    approvalsPending?: number;
  }) {
    this.activeUserCount = payload.activeUserCount;
    this.currentProfile = payload.profile;
    if (this.currentProfile?.manager) {
      this.managerName = this.currentProfile.manager;
    }
    this.spotlightPhoto = this.currentProfile?.photoUrl || 'assets/people/default-avatar.svg';
    const sortedTasks = [...payload.tasks].sort(
      (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
    );
    this.todayTasks = sortedTasks.slice(0, 3).map((task) => ({
      title: task.title,
      createdAt: task.createdAt
    }));
    this.pendingApprovalsCount = payload.approvalsPending ?? this.todayTasks.length;
    this.pendingRequests = payload.pendingLeaves.map((leave) => ({
      id: leave.id,
      type: leave.type,
      range: leave.range,
      status: leave.status,
      employee: leave.employeeName
    }));
    this.ideaHistory = payload.ideas;
    const ideaCount = payload.ideas?.length ?? 0;
    this.spotlightScore = this.calculateEngagementScore(this.currentProfile, ideaCount);
    this.spotlightPercent =
      this.spotlightScore === null ? null : Math.round((this.spotlightScore / 5) * 100);
    this.spotlightProgress = this.spotlightPercent ?? 0;
    this.pendingReimbursements = payload.reimbursements?.pending ?? 0;
    this.trainingsCompleted = payload.training.completed;
    this.complianceCoverage = payload.training.coverage;
    this.trainingsAssigned = payload.training.total;
  }

  async refreshComplianceCoverage() {
    const department = this.currentProfile?.department || this.sessionDepartment;
    const role = this.currentProfile?.role || this.sessionRole;
    const employeeName = this.currentProfile?.fullName || this.sessionName;
    if (!department || !role || !employeeName) {
      return;
    }
    try {
      const [assignments, responses] = await Promise.all([
        firstValueFrom(this.api.getTrainingAssignments({ limit: 200 })),
        firstValueFrom(this.api.getTrainingResponses({ employee: employeeName, limit: 200 }))
      ]);
      const filtered = assignments.filter((assignment) => {
        const assignedDepartment = assignment.department ?? 'All departments';
        const assignedAudience = assignment.audience ?? 'All employees';
        const departmentMatch =
          assignedDepartment === 'All departments' || assignedDepartment === department;
        const audienceMatch = assignedAudience === 'All employees' || assignedAudience === role;
        return departmentMatch && audienceMatch;
      });
      const completedIds = new Set(
        responses.filter((entry) => entry.passed).map((entry) => entry.assignmentId)
      );
      const completedCount = filtered.filter((assignment) => completedIds.has(assignment.id)).length;
      const total = filtered.length;
      this.trainingsAssigned = total;
      this.trainingsCompleted = completedCount;
      this.complianceCoverage = total ? Math.round((completedCount / total) * 100) : 0;
    } catch {
      return;
    }
  }

  private calculateEngagementScore(profile: EmployeeProfile | null, ideaCount = 0): number | null {
    if (!profile) {
      return null;
    }
    const inputs = [
      profile.surveyScore,
      profile.checkinsScore,
      profile.participationScore,
      profile.riskAdjustedScore
    ];
    const ideaScore = Math.min(100, ideaCount * 20);
    const hasValues = inputs.some(
      (value) => value !== undefined && value !== null && String(value).trim() !== ''
    );
    if (!hasValues && ideaScore === 0) {
      return 0;
    }
    const survey = Number(profile.surveyScore ?? 0);
    const checkins = Number(profile.checkinsScore ?? 0);
    const participation = Number(profile.participationScore ?? 0);
    const riskAdjusted = Number(profile.riskAdjustedScore ?? 0);
    const rawScore =
      0.4 * survey +
      0.2 * checkins +
      0.2 * participation +
      0.2 * riskAdjusted +
      ideaScore;
    const score = (rawScore / 200) * 5;
    return Math.max(0, Math.min(5, Math.round(score)));
  }

  async refreshIdeas() {
    try {
      this.ideaHistory = await firstValueFrom(
        this.api.getIdeas({ employeeEmail: this.sessionEmail || undefined, limit: 6 })
      );
    } catch {
      return;
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

  formatLeaveValue(value?: string) {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) {
      return 'Not set';
    }
    const isNumeric = /^\d+(\.\d+)?$/.test(trimmed);
    return isNumeric ? `${trimmed} days` : trimmed;
  }

  submitIdea() {
    if (!this.ideaForm.title || !this.ideaForm.summary) {
      this.ideaStatus = 'Add a title and summary before submitting.';
      return;
    }
    const payload = {
      title: this.ideaForm.title.trim(),
      type: this.ideaForm.type,
      summary: this.ideaForm.summary.trim(),
      manager: this.managerName,
      employeeEmail: this.sessionEmail
    };
    firstValueFrom(this.api.getUsers())
      .then((users) => {
        const managerEmail =
          users.find((user) => user.fullName === this.managerName)?.email ?? '';
        return Promise.all([
          firstValueFrom(this.api.createIdea(payload)),
          firstValueFrom(
            this.api.createTask({
              title: `Idea review: ${payload.title}`,
              owner: this.managerName,
              ownerEmail: managerEmail,
              due: 'This week',
              source: 'ideas'
            })
          )
        ]);
      })
      .then(([idea]) => {
        this.ideaHistory = [idea as IdeaRecord, ...this.ideaHistory];
        this.ideaStatus = `Idea sent to ${this.managerName}.`;
        this.ideaForm = {
          title: '',
          type: 'Product',
          summary: '',
          manager: this.managerName
        };
      })
      .catch(() => {
        this.ideaStatus = 'Unable to submit idea.';
      });
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
    const requestedDays = this.calculateLeaveDays(
      this.leaveForm.startDate,
      this.leaveForm.endDate
    );
    const available = this.getLeaveBalance(this.leaveForm.type);
    if (available === null) {
      this.leaveError = 'Leave balance not set for this type.';
      return;
    }
    if (requestedDays > available) {
      this.leaveError = `Not enough balance. Available ${available} days.`;
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

    const payload: Omit<LeaveRecord, 'id'> = {
      employeeName: this.adminDataName(),
      employeeEmail: this.sessionEmail,
      type: this.leaveForm.type,
      startDate: this.leaveForm.startDate,
      endDate: this.leaveForm.endDate,
      range,
      status: 'Pending manager approval',
      notes: this.leaveForm.notes
    };

    firstValueFrom(this.api.createLeave(payload))
      .then((leave) => {
        this.pendingRequests = [
          {
            id: leave.id,
            type: leave.type,
            range: leave.range,
            status: leave.status,
            employee: leave.employeeName
          },
          ...this.pendingRequests
        ];
        this.leaveError = '';
        this.leaveForm = { type: 'PTO', startDate: '', endDate: '', notes: '' };
      })
      .catch(() => {
        this.leaveError = 'Unable to submit leave request.';
      });
  }

  cancelRequest(index: number) {
    const confirmed = window.confirm(
      'Cancel this leave request? This cannot be undone.'
    );
    if (!confirmed) {
      return;
    }
    const target = this.pendingRequests[index];
    if (!target) {
      return;
    }
    firstValueFrom(this.api.updateLeaveStatus(target.id, 'Cancelled'))
      .then(() => {
        this.pendingRequests = this.pendingRequests.filter((_, i) => i !== index);
      })
      .catch(() => {
        return;
      });
  }

  adminDataName() {
    return this.currentProfile?.fullName || this.sessionName || 'Employee';
  }

  private calculateLeaveDays(startDate: string, endDate: string) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const msPerDay = 1000 * 60 * 60 * 24;
    const diff = Math.floor((end.getTime() - start.getTime()) / msPerDay);
    return Math.max(1, diff + 1);
  }

  private getLeaveBalance(type: string) {
    const profile = this.currentProfile;
    if (!profile) {
      return null;
    }
    const value =
      type === 'PTO'
        ? profile.annualPto
        : type === 'Sick'
          ? profile.sickLeave
          : type === 'Floating holidays'
            ? profile.floatingHolidays
            : type === 'Parental leave'
              ? profile.parentalLeave
              : '';
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
}
