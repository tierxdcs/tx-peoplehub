import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-teams',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './teams.component.html',
  styleUrl: './teams.component.scss'
})
export class TeamsComponent {
  teams = [
    {
      name: 'Operations',
      head: 'Nithin Gangadhar',
      roster: [
        { name: 'Jessie Moore', role: 'Network Engineer', location: 'Austin' },
        { name: 'Iman Shah', role: 'Systems Analyst', location: 'Remote' },
        { name: 'Ravi Patel', role: 'Infrastructure Lead', location: 'Dallas' }
      ]
    },
    {
      name: 'Facilities',
      head: 'Sofia Nguyen',
      roster: [
        { name: 'Liam Ortiz', role: 'Facilities Coordinator', location: 'Austin' },
        { name: 'Amira Patel', role: 'Maintenance Lead', location: 'Phoenix' }
      ]
    },
    {
      name: 'Security',
      head: 'Andre Lewis',
      roster: [
        { name: 'Priya Rao', role: 'Site Security Lead', location: 'Dallas' },
        { name: 'Marcus Lee', role: 'Access Control', location: 'Austin' }
      ]
    },
    {
      name: 'HR & People Ops',
      head: 'Chloe Bishop',
      roster: [
        { name: 'Ava Daniels', role: 'HRBP', location: 'Austin' },
        { name: 'Ethan Park', role: 'Talent Partner', location: 'Remote' }
      ]
    }
  ];
  selectedTeam: (typeof this.teams)[number] | null = null;

  openRoster(teamName: string) {
    this.selectedTeam = this.teams.find((team) => team.name === teamName) ?? null;
  }

  closeRoster() {
    this.selectedTeam = null;
  }
}
