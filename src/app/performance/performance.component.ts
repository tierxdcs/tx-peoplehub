import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-performance',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './performance.component.html',
  styleUrl: './performance.component.scss'
})
export class PerformanceComponent {
  reviews = [
    {
      name: 'Nithin Gangadhar',
      cycle: 'Q4 2025',
      status: 'In review',
      due: 'Jan 28'
    },
    {
      name: 'Jessie Moore',
      cycle: 'Q4 2025',
      status: 'Draft',
      due: 'Jan 30'
    },
    {
      name: 'Iman Shah',
      cycle: 'Q4 2025',
      status: 'Submitted',
      due: 'Completed'
    }
  ];
}
