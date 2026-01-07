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
      name: 'Operations',
      leader: 'Nithin Gangadhar',
      headcount: 312,
      teams: ['Network Ops', 'Site Reliability', 'Capacity Planning']
    },
    {
      name: 'Facilities',
      leader: 'Sofia Nguyen',
      headcount: 128,
      teams: ['Critical Infra', 'Maintenance', 'Energy Optimization']
    },
    {
      name: 'Security',
      leader: 'Andre Lewis',
      headcount: 74,
      teams: ['Physical Security', 'Access Control', 'Risk Monitoring']
    },
    {
      name: 'HR & People Ops',
      leader: 'Chloe Bishop',
      headcount: 32,
      teams: ['Talent', 'Total Rewards', 'Employee Experience']
    }
  ];
}
