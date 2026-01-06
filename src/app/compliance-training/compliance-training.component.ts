import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-compliance-training',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './compliance-training.component.html',
  styleUrl: './compliance-training.component.scss'
})
export class ComplianceTrainingComponent {
  trainings = [
    { title: 'Safety & PPE', status: 'Required', due: 'Feb 15' },
    { title: 'Data Center Access', status: 'In progress', due: 'Feb 20' },
    { title: 'Incident Response', status: 'Required', due: 'Mar 1' }
  ];
  completed = [
    { title: 'Workplace conduct', completed: 'Dec 12' },
    { title: 'Information security', completed: 'Nov 28' },
    { title: 'Equipment handling', completed: 'Oct 6' }
  ];
}
