import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-tasks',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './tasks.component.html',
  styleUrl: './tasks.component.scss'
})
export class TasksComponent {
  private readonly tasksKey = 'tx-peoplehub-tasks';
  tasks = [
    { title: 'Approve 6 time-off requests', owner: 'People Ops', due: 'Today' },
    { title: 'Finalize Dallas hiring plan', owner: 'Talent', due: 'Tomorrow' },
    { title: 'Review onboarding checklist', owner: 'HR', due: 'This week' }
  ];

  ngOnInit() {
    const stored = localStorage.getItem(this.tasksKey);
    if (!stored) {
      return;
    }
    try {
      const parsed = JSON.parse(stored) as typeof this.tasks;
      if (Array.isArray(parsed) && parsed.length) {
        this.tasks = [...parsed, ...this.tasks];
      }
    } catch {
      localStorage.removeItem(this.tasksKey);
    }
  }
}
