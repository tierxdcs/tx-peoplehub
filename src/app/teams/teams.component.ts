import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-teams',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './teams.component.html',
  styleUrl: './teams.component.scss'
})
export class TeamsComponent {
  private readonly storageKey = 'tx-peoplehub-teams';
  teams = [
    {
      name: 'Operations',
      head: 'Nithin Gangadhar',
      summary: 'Network ops, NOC, and response teams across TierX sites.',
      people: 312,
      coverage: '24/7',
      sites: 'Austin, Dallas, Phoenix',
      roster: [
        { name: 'Jessie Moore', role: 'Network Engineer', location: 'Austin' },
        { name: 'Iman Shah', role: 'Systems Analyst', location: 'Remote' },
        { name: 'Ravi Patel', role: 'Infrastructure Lead', location: 'Dallas' }
      ]
    },
    {
      name: 'Facilities',
      head: 'Sofia Nguyen',
      summary: 'Critical infrastructure, maintenance, and uptime planning.',
      people: 128,
      coverage: 'Regional',
      sites: 'Austin, Phoenix',
      roster: [
        { name: 'Liam Ortiz', role: 'Facilities Coordinator', location: 'Austin' },
        { name: 'Amira Patel', role: 'Maintenance Lead', location: 'Phoenix' }
      ]
    },
    {
      name: 'Security',
      head: 'Andre Lewis',
      summary: 'Site security, access control, and risk monitoring.',
      people: 74,
      coverage: '24/7',
      sites: 'Dallas, Austin',
      roster: [
        { name: 'Priya Rao', role: 'Site Security Lead', location: 'Dallas' },
        { name: 'Marcus Lee', role: 'Access Control', location: 'Austin' }
      ]
    },
    {
      name: 'HR & People Ops',
      head: 'Chloe Bishop',
      summary: 'Workforce planning, talent programs, and compliance.',
      people: 32,
      coverage: 'Business hours',
      sites: 'Austin',
      roster: [
        { name: 'Ava Daniels', role: 'HRBP', location: 'Austin' },
        { name: 'Ethan Park', role: 'Talent Partner', location: 'Remote' }
      ]
    }
  ];
  createOpen = false;
  form = {
    name: '',
    head: '',
    summary: '',
    people: 0,
    coverage: '',
    sites: ''
  };
  selectedTeam: (typeof this.teams)[number] | null = null;

  ngOnInit() {
    const stored = localStorage.getItem(this.storageKey);
    if (!stored) {
      return;
    }
    try {
      const parsed = JSON.parse(stored) as typeof this.teams;
      if (Array.isArray(parsed) && parsed.length) {
        this.teams = parsed;
      }
    } catch {
      localStorage.removeItem(this.storageKey);
    }
  }

  openRoster(teamName: string) {
    this.selectedTeam = this.teams.find((team) => team.name === teamName) ?? null;
  }

  closeRoster() {
    this.selectedTeam = null;
  }

  openCreateTeam() {
    this.createOpen = true;
  }

  closeCreateTeam() {
    this.createOpen = false;
  }

  createTeam() {
    if (!this.form.name || !this.form.head || !this.form.summary) {
      return;
    }
    const newTeam = {
      name: this.form.name.trim(),
      head: this.form.head.trim(),
      summary: this.form.summary.trim(),
      people: Number(this.form.people) || 0,
      coverage: this.form.coverage.trim() || 'Business hours',
      sites: this.form.sites.trim() || 'Austin',
      roster: []
    };
    this.teams = [newTeam, ...this.teams];
    localStorage.setItem(this.storageKey, JSON.stringify(this.teams));
    this.form = {
      name: '',
      head: '',
      summary: '',
      people: 0,
      coverage: '',
      sites: ''
    };
    this.createOpen = false;
  }
}
