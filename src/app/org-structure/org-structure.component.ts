import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-org-structure',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './org-structure.component.html',
  styleUrl: './org-structure.component.scss'
})
export class OrgStructureComponent {
  divisions = [
    {
      name: 'Sales & Marketing',
      leader: 'Ravi Kumar E',
      headcount: 148,
      teams: ['Enterprise Sales', 'Channel Partners', 'Brand & Growth']
    },
    {
      name: 'Finance & Operations',
      leader: 'Ravi Kulal',
      headcount: 96,
      teams: ['Finance', 'Procurement', 'Operations Excellence']
    },
    {
      name: 'Product Development & Technology',
      leader: 'Nithin Gangadhar',
      headcount: 182,
      teams: ['Platform Engineering', 'Product Management', 'Data Systems']
    },
    {
      name: 'Supply Chain Management',
      leader: 'Krishna Achar',
      headcount: 64,
      teams: ['Vendor Management', 'Logistics', 'Inventory Planning']
    },
    {
      name: 'Global Competency Center',
      leader: 'Martin Kipping',
      headcount: 86,
      teams: ['Center of Excellence', 'Process Automation', 'Analytics Enablement']
    }
  ];
}
