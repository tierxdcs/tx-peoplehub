import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService, DepartmentRecord, UserRecord } from '../services/api.service';

@Component({
  selector: 'app-people-directory',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './people-directory.component.html',
  styleUrl: './people-directory.component.scss'
})
export class PeopleDirectoryComponent {
  search = '';
  selectedDepartment = 'All departments';
  selectedStatus = 'Any status';
  people: Array<{
    id: string;
    name: string;
    role: string;
    location: string;
    department: string;
    status: string;
  }> = [];
  departments: DepartmentRecord[] = [];

  constructor(private readonly api: ApiService) {}

  async ngOnInit() {
    await Promise.all([this.loadPeople(), this.loadDepartments()]);
  }

  async loadPeople() {
    try {
      const users = await firstValueFrom(this.api.getUsers());
      this.people = users.map((user) => ({
        id: user.id,
        name: user.fullName,
        role: user.role,
        location: 'Unspecified',
        department: user.department,
        status: user.status
      }));
    } catch {
      this.people = [];
    }
  }

  async loadDepartments() {
    try {
      this.departments = await firstValueFrom(this.api.getDepartments());
    } catch {
      this.departments = [];
    }
  }

  get filteredPeople() {
    const search = this.search.trim().toLowerCase();
    return this.people.filter((person) => {
      const matchesSearch =
        !search ||
        person.name.toLowerCase().includes(search) ||
        person.role.toLowerCase().includes(search) ||
        person.department.toLowerCase().includes(search);
      const matchesDepartment =
        this.selectedDepartment === 'All departments' ||
        person.department === this.selectedDepartment;
      const matchesStatus =
        this.selectedStatus === 'Any status' ||
        person.status === this.selectedStatus;
      return matchesSearch && matchesDepartment && matchesStatus;
    });
  }
}
