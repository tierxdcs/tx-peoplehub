import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.scss'
})
export class AdminComponent {
  saved = false;

  save(event: Event) {
    event.preventDefault();
    const form = event.target as HTMLFormElement | null;
    if (!form || !form.reportValidity()) {
      this.saved = false;
      return;
    }

    this.saved = true;
  }
}
