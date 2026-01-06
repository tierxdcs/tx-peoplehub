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
  private readonly storageKey = 'tx-peoplehub-assigned-training';
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
  assignedModules: {
    title: string;
    audience: string;
    dueDate: string;
    progress: number;
  }[] = [];

  ngOnInit() {
    const storedAssignments = localStorage.getItem(this.storageKey);
    if (!storedAssignments) {
      return;
    }
    try {
      const parsed = JSON.parse(storedAssignments) as {
        title: string;
        audience: string;
        dueDate: string;
        progress: number;
      }[];
      if (Array.isArray(parsed)) {
        this.assignedModules = parsed;
      }
    } catch {
      localStorage.removeItem(this.storageKey);
    }
  }
}
