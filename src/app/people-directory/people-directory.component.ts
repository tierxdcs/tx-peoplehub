import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-people-directory',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './people-directory.component.html',
  styleUrl: './people-directory.component.scss'
})
export class PeopleDirectoryComponent {
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
}
