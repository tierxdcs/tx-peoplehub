import { Component, inject } from '@angular/core';
import { RouterLink, ActivatedRoute } from '@angular/router';

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

const PROFILES: Record<string, Profile> = {
  'alina-torres': {
    name: 'Nithin Gangadhar',
    title: 'Network Operations Manager',
    location: 'Austin, TX',
    team: 'Operations',
    manager: 'Chloe Bishop',
    managerChain: ['Chloe Bishop', 'Ravi Kulal', 'Martin Kipping', 'CEO'],
    status: 'Active',
    tenure: '3y 8m',
    photoUrl: 'assets/people/nithin-gangadhar.svg',
    certifications: [],
    teamMembers: [
      {
        name: 'Jessie Moore',
        role: 'Network Engineer',
        location: 'Austin',
        department: 'Operations',
        reportsTo: 'Nithin Gangadhar'
      },
      {
        name: 'Iman Shah',
        role: 'Systems Analyst',
        location: 'Remote',
        department: 'Operations',
        reportsTo: 'Nithin Gangadhar'
      },
      {
        name: 'Ravi Patel',
        role: 'Infrastructure Lead',
        location: 'Dallas',
        department: 'Operations',
        reportsTo: 'Nithin Gangadhar'
      },
      {
        name: 'Camila Cruz',
        role: 'NOC Technician',
        location: 'Phoenix',
        department: 'Operations',
        reportsTo: 'Nithin Gangadhar'
      },
      {
        name: 'Liam Ortiz',
        role: 'Facilities Coordinator',
        location: 'Austin',
        department: 'Facilities'
      }
    ]
  }
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
  private readonly storageKey = 'tx-peoplehub-admin-draft';
  readonly profileId =
    this.route.snapshot.paramMap.get('id') ?? 'alina-torres';
  readonly profile = PROFILES[this.profileId] ?? PROFILES['alina-torres'];
  isTeamModalOpen = false;
  adminDirectReports: { name: string; role: string; location: string }[] = [];
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

  ngOnInit() {
    const stored = localStorage.getItem(this.storageKey);
    if (!stored) {
      return;
    }

    try {
      const parsed = JSON.parse(stored) as {
        certifications?: string;
        fullName?: string;
        jobTitle?: string;
        location?: string;
        manager?: string;
        managerLevel2?: string;
        managerLevel3?: string;
        managerLevel4?: string;
        ceo?: string;
      };
      const certifications =
        parsed.certifications
          ?.split(',')
          .map((item) => item.trim())
          .filter(Boolean) ?? [];
      this.profile.certifications = certifications;
      if (parsed.manager === this.profile.name && parsed.fullName) {
        this.adminDirectReports = [
          {
            name: parsed.fullName,
            role: parsed.jobTitle ?? 'Direct report',
            location: parsed.location ?? 'Unspecified'
          }
        ];
      }
      const chain = [
        parsed.manager,
        parsed.managerLevel2,
        parsed.managerLevel3,
        parsed.managerLevel4,
        parsed.ceo
      ].filter((value): value is string => Boolean(value));
      if (chain.length) {
        this.profile.managerChain = chain;
      }
    } catch {
      this.profile.certifications = [];
    }
  }

  onPhotoSelected(event: Event) {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        this.profile.photoUrl = reader.result;
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
