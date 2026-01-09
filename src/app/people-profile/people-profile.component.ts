import { Component, inject } from '@angular/core';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService, EmployeeProfile, UserRecord } from '../services/api.service';

type Profile = {
  name: string;
  title: string;
  location: string;
  team: string;
  manager: string;
  managerChain: string[];
  status: string;
  tenure: string;
  engagementScore: number | null;
  engagementProgress: number;
  engagementPercent: number | null;
  photoUrl: string;
  certifications: string[];
  teamMembers: {
    name: string;
    role: string;
    location: string;
    department: string;
    reportsTo?: string;
  }[];
};

const EMPTY_PROFILE: Profile = {
  name: 'Employee',
  title: '',
  location: '',
  team: '',
  manager: '',
  managerChain: [],
  status: '',
  tenure: '',
  engagementScore: null,
  engagementProgress: 0,
  engagementPercent: null,
  photoUrl: 'assets/people/default-avatar.svg',
  certifications: [],
  teamMembers: []
};

@Component({
  selector: 'app-people-profile',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './people-profile.component.html',
  styleUrl: './people-profile.component.scss'
})
export class PeopleProfileComponent {
  private readonly route = inject(ActivatedRoute);
  readonly profileId = this.route.snapshot.paramMap.get('id') ?? 'current';
  profile = { ...EMPTY_PROFILE };
  employeeProfile: EmployeeProfile | null = null;
  isTeamModalOpen = false;
  adminDirectReports: { name: string; role: string; location: string }[] = [];
  users: UserRecord[] = [];
  ideaCount = 0;
  targetEmail = '';

  constructor(private readonly api: ApiService) {}

  get filteredTeamMembers() {
    return this.profile.teamMembers.filter(
      (member) => member.department === this.profile.team
    );
  }
  get directReports() {
    return [
      ...this.profile.teamMembers
        .filter((member) => member.reportsTo === this.profile.name)
        .map((member) => ({
          name: member.name,
          role: member.role,
          location: member.location
        })),
      ...this.adminDirectReports
    ];
  }

  async ngOnInit() {
    await this.loadUsers();
    this.resolveTargetEmail();
    await this.loadProfile();
    this.applyUserOverride();
    this.buildTeamMembers();
  }

  async loadProfile() {
    try {
      const profile = await firstValueFrom(
        this.api.getEmployeeProfile(
          this.targetEmail ? { email: this.targetEmail } : undefined
        )
      );
      if (!profile) {
        return;
      }
      this.employeeProfile = profile;
      this.profile = this.mapProfile(profile);
      await this.loadIdeaCount();
    } catch {
      this.profile = { ...EMPTY_PROFILE };
    }
  }

  async loadIdeaCount() {
    const email = this.employeeProfile?.email?.trim().toLowerCase() || this.targetEmail;
    if (!email) {
      this.ideaCount = 0;
      this.applyEngagementScore();
      return;
    }
    try {
      const ideas = await firstValueFrom(this.api.getIdeas({ employeeEmail: email, limit: 20 }));
      this.ideaCount = ideas.length;
    } catch {
      this.ideaCount = 0;
    }
    this.applyEngagementScore();
  }

  resolveTargetEmail() {
    const sessionRaw = localStorage.getItem('tx-peoplehub-session');
    let sessionEmail = '';
    if (sessionRaw) {
      try {
        const parsed = JSON.parse(sessionRaw) as { email?: string };
        sessionEmail = parsed.email?.trim().toLowerCase() || '';
      } catch {
        sessionEmail = '';
      }
    }
    if (this.profileId === 'current') {
      this.targetEmail = sessionEmail;
      return;
    }
    const match = this.users.find((user) => user.id === this.profileId);
    this.targetEmail = match?.email?.trim().toLowerCase() || sessionEmail;
  }

  async loadUsers() {
    try {
      this.users = await firstValueFrom(this.api.getUsers());
    } catch {
      this.users = [];
    }
  }

  applyUserOverride() {
    if (this.profileId === 'current') {
      return;
    }
    const match = this.users.find((user) => user.id === this.profileId);
    if (!match) {
      return;
    }
    this.profile = {
      ...this.profile,
      name: match.fullName,
      title: match.role,
      team: match.department,
      status: match.status
    };
  }

  buildTeamMembers() {
    if (!this.users.length || !this.profile.team) {
      this.profile.teamMembers = [];
      return;
    }
    this.profile.teamMembers = this.users
      .filter((user) => user.department === this.profile.team)
      .map((user) => ({
        name: user.fullName,
        role: user.role,
        location: 'Unspecified',
        department: user.department,
        reportsTo: ''
      }));
  }

  mapProfile(profile: EmployeeProfile): Profile {
    const certifications = profile.certifications
      ? profile.certifications
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      : [];
    const managerChain = [
      profile.ceo,
      profile.managerLevel4,
      profile.managerLevel3,
      profile.managerLevel2,
      profile.manager
    ].filter((value): value is string => Boolean(value));
    const engagementScore = this.calculateEngagementScore(profile, this.ideaCount);

    const engagementPercent =
      engagementScore === null ? null : Math.round((engagementScore / 5) * 100);
    return {
      name: profile.fullName || 'Employee',
      title: profile.jobTitle || '',
      location: profile.location || '',
      team: profile.department || '',
      manager: profile.manager || '',
      managerChain,
      status: profile.status || '',
      tenure: this.calculateTenureYears(profile.startDate),
      engagementScore,
      engagementProgress: engagementPercent ?? 0,
      engagementPercent,
      photoUrl: profile.photoUrl || EMPTY_PROFILE.photoUrl,
      certifications,
      teamMembers: []
    };
  }

  private calculateTenureYears(startDate?: string): string {
    const raw = String(startDate ?? '').trim();
    if (!raw) {
      return 'Not set';
    }
    const start = new Date(raw);
    if (Number.isNaN(start.getTime())) {
      return 'Not set';
    }
    const now = new Date();
    if (now.getTime() < start.getTime()) {
      return '00:00';
    }
    const totalMonths =
      (now.getFullYear() - start.getFullYear()) * 12 +
      (now.getMonth() - start.getMonth());
    const normalizedMonths = Math.max(0, totalMonths);
    const years = Math.floor(normalizedMonths / 12);
    const months = normalizedMonths % 12;
    return `${String(years).padStart(2, '0')}:${String(months).padStart(2, '0')}`;
  }

  private calculateEngagementScore(profile: EmployeeProfile, ideaCount = 0): number | null {
    const rawValues = [
      profile.surveyScore,
      profile.checkinsScore,
      profile.participationScore,
      profile.riskAdjustedScore
    ];
    const ideaScore = Math.min(100, ideaCount * 20);
    const hasValues = rawValues.some(
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

  private applyEngagementScore() {
    if (!this.employeeProfile) {
      return;
    }
    const engagementScore = this.calculateEngagementScore(this.employeeProfile, this.ideaCount);
    this.profile = {
      ...this.profile,
      engagementScore,
      engagementProgress:
        engagementScore === null ? 0 : Math.round((engagementScore / 5) * 100),
      engagementPercent:
        engagementScore === null ? null : Math.round((engagementScore / 5) * 100)
    };
  }

  onPhotoSelected(event: Event) {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result === 'string') {
        this.profile.photoUrl = reader.result;
        if (!this.employeeProfile) {
          return;
        }
        try {
          const payload = { ...this.employeeProfile, photoUrl: reader.result };
          this.employeeProfile = await firstValueFrom(this.api.saveEmployeeProfile(payload));
        } catch {
          // Keep local preview even if the save fails.
        }
      }
    };
    reader.readAsDataURL(file);
  }

  openTeamModal() {
    this.isTeamModalOpen = true;
  }

  closeTeamModal() {
    this.isTeamModalOpen = false;
  }
}
