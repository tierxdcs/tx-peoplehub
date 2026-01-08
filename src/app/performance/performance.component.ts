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
  reviews: { name: string; cycle: string; status: string; due: string }[] = [];
  goals: { title: string; progress: number }[] = [];
}
