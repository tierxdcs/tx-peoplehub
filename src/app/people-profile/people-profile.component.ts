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
};

const PROFILES: Record<string, Profile> = {
  'alina-torres': {
    name: 'Alina Torres',
    title: 'Network Operations Manager',
    location: 'Austin, TX',
    team: 'Operations',
    manager: 'Chloe Bishop',
    status: 'Active',
    tenure: '3y 8m'
  }
};

@Component({
  selector: 'app-people-profile',
  imports: [RouterLink],
  templateUrl: './people-profile.component.html',
  styleUrl: './people-profile.component.scss'
})
export class PeopleProfileComponent {
  private readonly route = inject(ActivatedRoute);
  readonly profile =
    PROFILES[this.route.snapshot.paramMap.get('id') ?? ''] ??
    PROFILES['alina-torres'];
}
