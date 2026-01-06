import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

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
  people = [
    {
      id: 'alina-torres',
      name: 'Nithin Gangadhar',
      role: 'Network Operations Manager',
      location: 'Austin, TX',
      department: 'Operations',
      status: 'Active'
    },
    {
      id: 'jessie-moore',
      name: 'Jessie Moore',
      role: 'Network Engineer',
      location: 'Austin, TX',
      department: 'Operations',
      status: 'Active'
    },
    {
      id: 'iman-shah',
      name: 'Iman Shah',
      role: 'Systems Analyst',
      location: 'Remote',
      department: 'Operations',
      status: 'Active'
    },
    {
      id: 'ravi-patel',
      name: 'Ravi Patel',
      role: 'Infrastructure Lead',
      location: 'Dallas, TX',
      department: 'Operations',
      status: 'On leave'
    }
  ];

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
