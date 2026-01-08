import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService, TeamRecord, UserRecord } from '../services/api.service';

@Component({
  selector: 'app-teams',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './teams.component.html',
  styleUrl: './teams.component.scss'
})
export class TeamsComponent {
  teams: Array<
    TeamRecord & {
      people: number;
      roster: { name: string; role: string; location: string }[];
    }
  > = [];
  users: UserRecord[] = [];
  selectedTeam: (typeof this.teams)[number] | null = null;

  constructor(private readonly api: ApiService) {}

  async ngOnInit() {
    await Promise.all([this.loadTeams(), this.loadUsers()]);
  }

  async loadTeams() {
    try {
      const teams = await firstValueFrom(this.api.getTeams());
      this.teams = teams.map((team) => ({
        ...team,
        people: team.peopleCount,
        roster: []
      }));
    } catch {
      this.teams = [];
    }
  }

  async loadUsers() {
    try {
      this.users = await firstValueFrom(this.api.getUsers());
    } catch {
      this.users = [];
    }
  }

  openRoster(teamName: string) {
    const team = this.teams.find((team) => team.name === teamName) ?? null;
    if (!team) {
      this.selectedTeam = null;
      return;
    }
    const roster = this.users
      .filter((user) => user.department === team.name)
      .map((user) => ({
        name: user.fullName,
        role: user.role,
        location: 'Unspecified'
      }));
    this.selectedTeam = { ...team, roster };
  }

  closeRoster() {
    this.selectedTeam = null;
  }

  // Team creation moved to Settings.
}
