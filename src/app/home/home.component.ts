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
  spotlightPhoto = 'assets/people/default-avatar.svg';
  todayTasks: { title: string }[] = [];
  complianceCoverage = 0;
  trainingsCompleted = 0;
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

  constructor(private readonly api: ApiService) {}

  async ngOnInit() {
    this.loadSession();
    await this.loadDashboard();
  }

  loadSession() {
    const raw = localStorage.getItem('tx-peoplehub-session');
    if (!raw) {
      return;
    }
    try {
      const parsed = JSON.parse(raw) as { email?: string; name?: string };
      this.sessionEmail = parsed.email?.trim().toLowerCase() || '';
      this.sessionName = parsed.name?.trim() || '';
    } catch {
      this.sessionEmail = '';
      this.sessionName = '';
    }
  }

  async loadDashboard() {
    try {
      const payload = await firstValueFrom(this.api.getHomeDashboard(this.sessionEmail || undefined));
      this.activeUserCount = payload.activeUserCount;
      this.currentProfile = payload.profile;
      if (this.currentProfile?.manager) {
        this.managerName = this.currentProfile.manager;
      }
      this.spotlightScore = this.calculateEngagementScore(this.currentProfile);
      this.spotlightProgress = this.spotlightScore ?? 0;
      this.spotlightPhoto = this.currentProfile?.photoUrl || 'assets/people/default-avatar.svg';
      this.todayTasks = payload.tasks.slice(0, 3).map((task) => ({ title: task.title }));
      this.pendingRequests = payload.pendingLeaves.map((leave) => ({
        id: leave.id,
        type: leave.type,
        range: leave.range,
        status: leave.status,
        employee: leave.employeeName
      }));
      this.ideaHistory = payload.ideas;
      this.pendingReimbursements = payload.reimbursements?.pending ?? 0;
      this.trainingsCompleted = payload.training.completed;
      this.complianceCoverage = payload.training.coverage;
    } catch {
      this.currentProfile = null;
      this.activeUserCount = 0;
      this.spotlightScore = null;
      this.spotlightProgress = 0;
      this.spotlightPhoto = 'assets/people/default-avatar.svg';
      this.todayTasks = [];
      this.pendingRequests = [];
      this.ideaHistory = [];
      this.pendingReimbursements = 0;
      this.trainingsCompleted = 0;
      this.complianceCoverage = 0;
    }
  }

  private calculateEngagementScore(profile: EmployeeProfile | null): number | null {
    if (!profile) {
      return null;
    }
    const inputs = [
      profile.surveyScore,
      profile.checkinsScore,
      profile.participationScore,
      profile.riskAdjustedScore
    ];
    const hasValues = inputs.some(
      (value) => value !== undefined && value !== null && String(value).trim() !== ''
    );
    if (!hasValues) {
      return null;
    }
    const survey = Number(profile.surveyScore ?? 0);
    const checkins = Number(profile.checkinsScore ?? 0);
    const participation = Number(profile.participationScore ?? 0);
    const riskAdjusted = Number(profile.riskAdjustedScore ?? 0);
    const score =
      0.4 * survey + 0.2 * checkins + 0.2 * participation + 0.2 * riskAdjusted;
    return Math.min(100, Math.max(0, Math.round(score)));
  }

  async refreshIdeas() {
    try {
      this.ideaHistory = await firstValueFrom(this.api.getIdeas(this.sessionEmail || undefined));
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
        this.ideaHistory = [idea, ...this.ideaHistory];
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
}
