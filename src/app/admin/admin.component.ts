import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.scss'
})
export class AdminComponent {
  private readonly storageKey = 'tx-peoplehub-admin-draft';
  private readonly departmentsKey = 'tx-peoplehub-departments';
  saved = false;
  departments: { name: string; head: string }[] = [];
  adminData = {
    fullName: '',
    employeeId: '',
    email: '',
    location: 'Austin, TX',
    department: 'Operations',
    startDate: '',
    jobTitle: '',
    manager: '',
    employmentType: 'Full-time',
    status: 'Active',
    schedule: 'Day shift',
    costCenter: '',
    baseSalary: '',
    paySchedule: 'Bi-weekly',
    bonusEligible: 'Yes',
    equityPlan: 'Not eligible',
    benefitsTier: 'Standard',
    compensationEffectiveDate: '',
    offerLetterName: '',
    offerLetterData: '',
    compBand: '',
    compPositioning: 'Mid-senior',
    annualPto: '',
    sickLeave: '',
    floatingHolidays: '',
    parentalLeave: '',
    carryoverCap: '',
    policyEffective: '',
    certifications: '',
    backgroundCheck: 'Verified',
    safetyTraining: 'Completed',
    workAuthorization: 'Valid',
    complianceDocumentName: '',
    nextAuditDate: '',
    checklistOffer: false,
    checklistEquipment: false,
    checklistBadges: false,
    checklistOrientation: false,
    trainingModules: [] as string[]
  };

  ngOnInit() {
    const storedDepartments = localStorage.getItem(this.departmentsKey);
    if (storedDepartments) {
      try {
        const parsed = JSON.parse(storedDepartments) as {
          name: string;
          head: string;
        }[];
        if (Array.isArray(parsed)) {
          this.departments = parsed;
        }
      } catch {
        localStorage.removeItem(this.departmentsKey);
      }
    }

    const raw = localStorage.getItem(this.storageKey);
    if (!raw) {
      return;
    }
    try {
      this.adminData = { ...this.adminData, ...JSON.parse(raw) };
    } catch {
      localStorage.removeItem(this.storageKey);
    }
  }

  save(event: Event) {
    event.preventDefault();
    const form = event.target as HTMLFormElement | null;
    if (!form || !form.reportValidity()) {
      this.saved = false;
      return;
    }

    localStorage.setItem(this.storageKey, JSON.stringify(this.adminData));
    this.saved = true;
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement | null;
    const fileName = input?.files?.[0]?.name ?? '';
    this.adminData.complianceDocumentName = fileName;
  }

  onOfferLetterSelected(event: Event) {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        this.adminData.offerLetterName = file.name;
        this.adminData.offerLetterData = reader.result;
      }
    };
    reader.readAsDataURL(file);
  }

  onTrainingModulesSelected(event: Event) {
    const input = event.target as HTMLInputElement | null;
    const files = input?.files ? Array.from(input.files) : [];
    if (!files.length) {
      return;
    }
    this.adminData.trainingModules = files.map((file) => file.name);
  }
}
