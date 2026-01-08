import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../services/api.service';

@Component({
  selector: 'app-financials',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './financials.component.html',
  styleUrl: './financials.component.scss'
})
export class FinancialsComponent {
  offerLetterName = '';
  offerLetterData = '';

  constructor(private readonly api: ApiService) {}

  async ngOnInit() {
    try {
      const profile = await firstValueFrom(this.api.getEmployeeProfile());
      this.offerLetterName = profile?.offerLetterName ?? '';
      this.offerLetterData = profile?.offerLetterData ?? '';
    } catch {
      this.offerLetterName = '';
      this.offerLetterData = '';
    }
  }
}
