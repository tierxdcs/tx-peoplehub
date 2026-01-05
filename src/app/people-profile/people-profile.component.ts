import { Component, inject } from '@angular/core';
import { RouterLink, ActivatedRoute } from '@angular/router';

type Profile = {
  name: string;
  title: string;
  location: string;
  team: string;
  manager: string;
  status: string;
  tenure: string;
  photoUrl: string;
  certifications: string[];
  teamMembers: { name: string; role: string; location: string }[];
};

const PROFILES: Record<string, Profile> = {
  'alina-torres': {
    name: 'Nithin Gangadhar',
    title: 'Network Operations Manager',
    location: 'Austin, TX',
    team: 'Operations',
    manager: 'Chloe Bishop',
    status: 'Active',
    tenure: '3y 8m',
    photoUrl: 'assets/people/nithin-gangadhar.svg',
    certifications: [],
    teamMembers: [
      { name: 'Jessie Moore', role: 'Network Engineer', location: 'Austin' },
      { name: 'Iman Shah', role: 'Systems Analyst', location: 'Remote' },
      { name: 'Ravi Patel', role: 'Infrastructure Lead', location: 'Dallas' },
      { name: 'Camila Cruz', role: 'NOC Technician', location: 'Phoenix' }
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

  ngOnInit() {
    const stored = localStorage.getItem(this.storageKey);
    if (!stored) {
      return;
    }

    try {
      const parsed = JSON.parse(stored) as { certifications?: string };
      const certifications =
        parsed.certifications
          ?.split(',')
          .map((item) => item.trim())
          .filter(Boolean) ?? [];
      this.profile.certifications = certifications;
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
