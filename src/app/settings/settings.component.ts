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
  newDepartment = { name: '', head: '' };
  departments = [
    { name: 'Operations', head: 'Nithin Gangadhar' },
    { name: 'Facilities', head: 'Sofia Nguyen' },
    { name: 'Security', head: 'Andre Lewis' },
    { name: 'HR & People Ops', head: 'Chloe Bishop' }
  ];

  addDepartment() {
    const name = this.newDepartment.name.trim();
    const head = this.newDepartment.head.trim();
    if (!name || !head) {
      return;
    }
    this.departments = [...this.departments, { name, head }];
    this.newDepartment = { name: '', head: '' };
  }

  removeDepartment(index: number) {
    this.departments = this.departments.filter((_, i) => i !== index);
  }
}
