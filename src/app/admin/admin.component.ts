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
  private readonly usersKey = 'tx-peoplehub-users';
  saved = false;
  departments: { name: string; head: string }[] = [];
  userStatus = '';
  users: {
    fullName: string;
    email: string;
    department: string;
    role: 'Employee' | 'Manager' | 'Admin' | 'Superadmin';
    status: 'Active' | 'Deactivated';
    password?: string;
  }[] = [];
  editIndex: number | null = null;
  editUser = {
    fullName: '',
    email: '',
    department: '',
    role: 'Employee' as 'Employee' | 'Manager' | 'Admin' | 'Superadmin',
    status: 'Active' as 'Active' | 'Deactivated',
    password: ''
  };
  createPassword = '';
  adminData = {
    fullName: '',
    employeeId: '',
    email: '',
    location: 'Austin, TX',
    department: 'Operations',
    startDate: '',
    jobTitle: '',
    manager: '',
    managerLevel2: '',
    managerLevel3: '',
    managerLevel4: '',
    ceo: '',
    role: 'Employee',
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
    checklistBusinessCard: false,
    checklistOfferOwner: '',
    checklistEquipmentOwner: '',
    checklistBadgesOwner: '',
    checklistOrientationOwner: '',
    checklistBusinessCardOwner: ''
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
      this.loadUsers();
      return;
    }
    try {
      this.adminData = { ...this.adminData, ...JSON.parse(raw) };
    } catch {
      localStorage.removeItem(this.storageKey);
    }

    this.loadUsers();
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

  get managerOptions() {
    const options = this.users
      .filter((user) => user.role === 'Manager' || user.role === 'Admin' || user.role === 'Superadmin')
      .map((user) => user.fullName);
    const fallback = [this.adminData.manager, this.adminData.managerLevel2, this.adminData.managerLevel3]
      .filter((name) => !!name)
      .map((name) => name as string);
    return Array.from(new Set([...options, ...fallback]));
  }

  loadUsers() {
    const stored = localStorage.getItem(this.usersKey);
    if (!stored) {
      return;
    }
    try {
      const parsed = JSON.parse(stored) as typeof this.users;
      if (Array.isArray(parsed)) {
        this.users = parsed;
      }
    } catch {
      localStorage.removeItem(this.usersKey);
    }
  }

  saveUsers() {
    localStorage.setItem(this.usersKey, JSON.stringify(this.users));
  }

  createUserFromProfile() {
    if (!this.adminData.fullName || !this.adminData.email) {
      this.userStatus = 'Complete the employee profile before creating a user.';
      return;
    }
    if (!this.createPassword) {
      this.userStatus = 'Set a temporary password before creating the user.';
      return;
    }
    const newUser = {
      fullName: this.adminData.fullName.trim(),
      email: this.adminData.email.trim(),
      department: this.adminData.department,
      role: this.adminData.role as 'Employee' | 'Manager' | 'Admin' | 'Superadmin',
      status: 'Active' as const,
      password: this.createPassword
    };
    this.users = [newUser, ...this.users];
    this.saveUsers();
    this.userStatus = 'User created.';
    this.createPassword = '';
  }

  updateUserRole(index: number, role: 'Employee' | 'Manager' | 'Admin' | 'Superadmin') {
    const user = this.users[index];
    if (!user) {
      return;
    }
    user.role = role;
    this.saveUsers();
    this.userStatus = 'Role updated.';
  }

  deactivateUser(index: number) {
    const user = this.users[index];
    if (!user) {
      return;
    }
    const confirmed = window.confirm(`Deactivate ${user.fullName}?`);
    if (!confirmed) {
      return;
    }
    user.status = 'Deactivated';
    this.saveUsers();
    this.userStatus = 'User deactivated.';
  }

  openEditUser(index: number) {
    const user = this.users[index];
    if (!user) {
      return;
    }
    this.editIndex = index;
    this.editUser = { ...user, password: user.password ?? '' };
  }

  closeEditUser() {
    this.editIndex = null;
  }

  saveEditUser() {
    if (this.editIndex === null) {
      return;
    }
    this.users[this.editIndex] = { ...this.editUser };
    this.saveUsers();
    this.userStatus = 'User updated.';
    this.closeEditUser();
  }
}
