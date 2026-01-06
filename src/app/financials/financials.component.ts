import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-financials',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './financials.component.html',
  styleUrl: './financials.component.scss'
})
export class FinancialsComponent {
  private readonly adminDraftKey = 'tx-peoplehub-admin-draft';
  offerLetterName = '';
  offerLetterData = '';

  ngOnInit() {
    const stored = localStorage.getItem(this.adminDraftKey);
    if (!stored) {
      return;
    }
    try {
      const parsed = JSON.parse(stored) as {
        offerLetterName?: string;
        offerLetterData?: string;
      };
      this.offerLetterName = parsed.offerLetterName ?? '';
      this.offerLetterData = parsed.offerLetterData ?? '';
    } catch {
      this.offerLetterName = '';
      this.offerLetterData = '';
    }
  }
}
