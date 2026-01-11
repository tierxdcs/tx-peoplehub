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
  selectedStatus = 'Active';
  people: Array<{
    id: string;
    name: string;
    role: string;
    location: string;
    department: string;
    status: string;
    email: string;
    employeeId: string;
  }> = [];
  departments: DepartmentRecord[] = [];
  private readonly pageSize = 30;
  private offset = 0;
  hasMore = true;
  isLoadingMore = false;

  constructor(private readonly api: ApiService) {}

  async ngOnInit() {
    await Promise.all([this.loadPeople(true), this.loadDepartments()]);
  }

  async loadPeople(reset = false) {
    try {
      if (reset) {
        this.offset = 0;
        this.people = [];
        this.hasMore = true;
      }
      this.isLoadingMore = true;
      const users = await firstValueFrom(
        this.api.getUsers({ status: 'Active', limit: this.pageSize, offset: this.offset })
      );
      const mapped = users.map((user) => ({
        id: user.id,
        name: user.fullName || '',
        role: user.role || '',
        location: 'Unspecified',
        department: user.department || '',
        status: user.status || '',
        email: user.email || '',
        employeeId: user.employeeId || ''
      }));
      this.people = reset ? mapped : [...this.people, ...mapped];
      this.hasMore = users.length === this.pageSize;
      this.isLoadingMore = false;
    } catch {
      this.isLoadingMore = false;
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
        (person.name || '').toLowerCase().includes(search) ||
        (person.role || '').toLowerCase().includes(search) ||
        (person.department || '').toLowerCase().includes(search);
      const matchesDepartment =
        this.selectedDepartment === 'All departments' ||
        person.department === this.selectedDepartment;
      const matchesStatus = person.status === 'Active';
      return matchesSearch && matchesDepartment && matchesStatus;
    });
  }

  loadMore() {
    if (this.isLoadingMore || !this.hasMore) {
      return;
    }
    this.offset += this.pageSize;
    void this.loadPeople(false);
  }

  getInitials(name: string) {
    const parts = (name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) {
      return 'TX';
    }
    return parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('');
  }

  markDirectoryNavigation() {
    sessionStorage.setItem('tx-peoplehub-from-directory', 'true');
  }
}
