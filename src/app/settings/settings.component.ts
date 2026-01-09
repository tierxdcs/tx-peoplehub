import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService, DepartmentRecord, TeamRecord } from '../services/api.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss'
})
export class SettingsComponent {
  newDepartment = { name: '', head: '' };
  departments: DepartmentRecord[] = [];
  teamForm = { name: '', head: '', summary: '' };
  teamStatus = '';
  teams: TeamRecord[] = [];

  constructor(private readonly api: ApiService) {}

  async ngOnInit() {
    try {
      this.departments = await firstValueFrom(this.api.getDepartments());
    } catch {
      this.departments = [];
    }
    await this.loadTeams();
  }

  addDepartment() {
    const name = this.newDepartment.name.trim();
    const head = this.newDepartment.head.trim();
    if (!name || !head) {
      return;
    }
    firstValueFrom(this.api.createDepartment({ name, head }))
      .then((saved) => {
        this.departments = [...this.departments, saved];
        this.newDepartment = { name: '', head: '' };
      })
      .catch(() => {
        return;
      });
  }

  removeDepartment(index: number) {
    const target = this.departments[index];
    if (!target) {
      return;
    }
    firstValueFrom(this.api.deleteDepartment(target.id))
      .then(() => {
        this.departments = this.departments.filter((_, i) => i !== index);
      })
      .catch(() => {
        return;
      });
  }

  async loadTeams() {
    try {
      this.teams = await firstValueFrom(this.api.getTeams());
      if (!this.teams.length) {
        this.teamStatus = 'No teams found yet.';
      }
    } catch {
      this.teams = [];
      this.teamStatus = 'Unable to load teams from the server.';
    }
  }

  async createTeam() {
    const name = this.teamForm.name.trim();
    const head = this.teamForm.head.trim();
    const summary = this.teamForm.summary.trim();
    if (!name || !head) {
      this.teamStatus = 'Team name and team leader are required.';
      return;
    }
    const payload = {
      name,
      head,
      summary,
      peopleCount: 0,
      coverage: 'Business hours',
      sites: 'Austin'
    };
    try {
      const saved: TeamRecord = await firstValueFrom(this.api.createTeam(payload));
      this.teamStatus = 'Team created.';
      this.teamForm = { name: '', head: '', summary: '' };
      await this.loadTeams();
      const exists = this.teams.some((team) => team.id === saved.id);
      if (!exists) {
        this.teamStatus = 'Team saved, but refresh failed. Please reload.';
      }
    } catch {
      this.teamStatus = 'Unable to create team.';
    }
  }

  removeTeam(index: number) {
    const target = this.teams[index];
    if (!target) {
      return;
    }
    const confirmed = window.confirm(`Delete ${target.name}? This cannot be undone.`);
    if (!confirmed) {
      return;
    }
    firstValueFrom(this.api.deleteTeam(target.id))
      .then(() => {
        this.teams = this.teams.filter((_, i) => i !== index);
      })
      .catch(() => {
        this.teamStatus = 'Unable to delete team.';
      });
  }
}
