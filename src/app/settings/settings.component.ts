import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss'
})
export class SettingsComponent {
  private readonly storageKey = 'tx-peoplehub-departments';
  newDepartment = { name: '', head: '' };
  departments = [
    { name: 'Operations', head: 'Nithin Gangadhar' },
    { name: 'Facilities', head: 'Sofia Nguyen' },
    { name: 'Security', head: 'Andre Lewis' },
    { name: 'HR & People Ops', head: 'Chloe Bishop' }
  ];

  ngOnInit() {
    const stored = localStorage.getItem(this.storageKey);
    if (!stored) {
      return;
    }
    try {
      const parsed = JSON.parse(stored) as { name: string; head: string }[];
      if (Array.isArray(parsed) && parsed.length) {
        this.departments = parsed;
      }
    } catch {
      localStorage.removeItem(this.storageKey);
    }
  }

  addDepartment() {
    const name = this.newDepartment.name.trim();
    const head = this.newDepartment.head.trim();
    if (!name || !head) {
      return;
    }
    this.departments = [...this.departments, { name, head }];
    this.newDepartment = { name: '', head: '' };
    localStorage.setItem(this.storageKey, JSON.stringify(this.departments));
  }

  removeDepartment(index: number) {
    this.departments = this.departments.filter((_, i) => i !== index);
    localStorage.setItem(this.storageKey, JSON.stringify(this.departments));
  }
}
