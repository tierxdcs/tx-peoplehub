import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss'
})
export class HomeComponent {
  isBalanceOpen = false;
  pendingRequests = [
    { type: 'PTO', range: 'Feb 12 - Feb 14', status: 'Pending' },
    { type: 'Sick', range: 'Jan 22', status: 'Pending' }
  ];

  openBalances() {
    this.isBalanceOpen = true;
  }

  closeBalances() {
    this.isBalanceOpen = false;
  }
}
