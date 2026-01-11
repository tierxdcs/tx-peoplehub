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
  annualSalary = '₹0';
  variablePayPercent = '';
  paySchedule = '';
  bonusEligible = '';
  equityPlan = '';
  benefitsTier = '';
  medicalStatus = '';
  dentalStatus = '';
  visionStatus = '';
  compBand = '';
  compPositioning = '';
  showAnnualSalary = false;
  sessionEmail = '';

  constructor(private readonly api: ApiService) {}

  async ngOnInit() {
    this.loadSession();
    try {
      const profile = await firstValueFrom(
        this.api.getEmployeeProfile(
          this.sessionEmail ? { email: this.sessionEmail, fresh: true } : { fresh: true }
        )
      );
      this.offerLetterName = profile?.offerLetterName ?? '';
      this.offerLetterData = profile?.offerLetterData ?? '';
      this.variablePayPercent = profile?.variablePayPercent ?? '';
      this.paySchedule = profile?.paySchedule ?? '';
      this.bonusEligible = profile?.bonusEligible ?? '';
      this.equityPlan = profile?.equityPlan ?? '';
      this.benefitsTier = profile?.benefitsTier ?? '';
      this.medicalStatus = profile?.medicalStatus ?? '';
      this.dentalStatus = profile?.dentalStatus ?? '';
      this.visionStatus = profile?.visionStatus ?? '';
      this.compBand = profile?.compBand ?? '';
      this.compPositioning = profile?.compPositioning ?? '';
      this.annualSalary = this.formatSalary(profile?.baseSalary ?? '');
    } catch {
      this.offerLetterName = '';
      this.offerLetterData = '';
      this.variablePayPercent = '';
      this.paySchedule = '';
      this.bonusEligible = '';
      this.equityPlan = '';
      this.benefitsTier = '';
      this.medicalStatus = '';
      this.dentalStatus = '';
      this.visionStatus = '';
      this.compBand = '';
      this.compPositioning = '';
      this.annualSalary = '₹0';
    }
  }

  loadSession() {
    const rawSession = localStorage.getItem('tx-peoplehub-session');
    if (!rawSession) {
      return;
    }
    try {
      const parsed = JSON.parse(rawSession) as { email?: string };
      this.sessionEmail = parsed.email?.trim().toLowerCase() ?? '';
    } catch {
      this.sessionEmail = '';
    }
  }

  formatSalary(value: string) {
    const trimmed = value?.toString().trim() || '';
    if (!trimmed) {
      return '₹0';
    }
    if (trimmed.startsWith('₹')) {
      return trimmed;
    }
    const numeric = trimmed.replace(/[^\d.]/g, '');
    if (!numeric) {
      return '₹0';
    }
    const parts = numeric.split('.');
    const integer = parts[0] ?? '0';
    const formatted = Number(integer).toLocaleString('en-IN');
    const decimal = parts[1] ? `.${parts[1]}` : '';
    return `₹${formatted}${decimal}`;
  }

  toggleAnnualSalary() {
    this.showAnnualSalary = !this.showAnnualSalary;
  }
}
