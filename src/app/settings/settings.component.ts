import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService, DepartmentRecord } from '../services/api.service';

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

  constructor(private readonly api: ApiService) {}

  async ngOnInit() {
    try {
      this.departments = await firstValueFrom(this.api.getDepartments());
    } catch {
      this.departments = [];
    }
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
}
