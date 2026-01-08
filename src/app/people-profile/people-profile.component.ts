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
    await Promise.all([this.loadProfile(), this.loadUsers()]);
    this.applyUserOverride();
    this.buildTeamMembers();
  }

  async loadProfile() {
    try {
      const profile = await firstValueFrom(this.api.getEmployeeProfile());
      if (!profile) {
        return;
      }
      this.employeeProfile = profile;
      this.profile = this.mapProfile(profile);
    } catch {
      this.profile = { ...EMPTY_PROFILE };
    }
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
      profile.manager,
      profile.managerLevel2,
      profile.managerLevel3,
      profile.managerLevel4,
      profile.ceo
    ].filter((value): value is string => Boolean(value));

    return {
      name: profile.fullName || 'Employee',
      title: profile.jobTitle || '',
      location: profile.location || '',
      team: profile.department || '',
      manager: profile.manager || '',
      managerChain,
      status: profile.status || '',
      tenure: profile.startDate || '',
      photoUrl: profile.photoUrl || EMPTY_PROFILE.photoUrl,
      certifications,
      teamMembers: []
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
