import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService, TeamRecord, UserRecord, EmployeeProfile } from '../services/api.service';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.scss'
})
export class AdminComponent {
  saved = false;
  savedMessage = '';
  teams: TeamRecord[] = [];
  userStatus = '';
  taskStatus = '';
  users: UserRecord[] = [];
  editIndex: number | null = null;
  editUser = {
    fullName: '',
    email: '',
    department: '',
    role: 'Employee' as 'Employee' | 'Manager' | 'Admin' | 'Superadmin',
    status: 'Active' as 'Active' | 'Deactivated',
    director: 'No'
  };
  createPassword = '';
  editPassword = '';
  adminData = {
    fullName: '',
    employeeId: '',
    email: '',
    location: 'Bengaluru',
    department: '',
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
    director: 'No',
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
    surveyScore: '',
    checkinsScore: '',
    participationScore: '',
    riskAdjustedScore: '',
    photoUrl: '',
    complianceDocumentName: '',
    nextAuditDate: '',
    checklistOffer: false,
    checklistEquipment: false,
    checklistBadges: false,
    checklistOrientation: false,
    checklistBusinessCard: false,
    checklistCustom: [] as { title: string; owner: string; done: boolean }[],
    checklistOfferOwner: '',
    checklistEquipmentOwner: '',
    checklistBadgesOwner: '',
    checklistOrientationOwner: '',
    checklistBusinessCardOwner: ''
  };
  newChecklistItem = { title: '', owner: '' };

  constructor(private readonly api: ApiService) {}

  async ngOnInit() {
    await Promise.all([this.loadTeams(), this.loadUsers(), this.loadProfile()]);
  }

  async save(event: Event) {
    event.preventDefault();
    const form = event.target as HTMLFormElement | null;
    if (!form || !form.reportValidity()) {
      this.saved = false;
      return;
    }

    try {
      const saved = await firstValueFrom(this.api.saveEmployeeProfile(this.adminData as EmployeeProfile));
      this.adminData = { ...this.adminData, ...saved };
      this.saved = true;
      const name = this.adminData.fullName?.trim() || 'Employee';
      const employeeId = this.adminData.employeeId?.trim() || 'N/A';
      let accessNote = '';
      if (this.adminData.fullName && this.adminData.email) {
        try {
          const userPayload = {
            fullName: this.adminData.fullName.trim(),
            email: this.adminData.email.trim(),
            department: this.adminData.department,
            role: this.adminData.role as 'Employee' | 'Manager' | 'Admin' | 'Superadmin',
            status: this.adminData.status === 'Separated' ? 'Deactivated' : 'Active',
            director: this.adminData.director,
            password: this.createPassword || undefined
          };
          const userSaved = await firstValueFrom(this.api.createUser(userPayload));
          const existsIndex = this.users.findIndex((user) => user.email === userSaved.email);
          if (existsIndex >= 0) {
            this.users = this.users.map((user, index) => (index === existsIndex ? userSaved : user));
          } else {
            this.users = [userSaved, ...this.users];
          }
          accessNote = ' Access granted.';
        } catch {
          accessNote = '';
        }
      }
      this.savedMessage = `Onboarding completed for ${name} (ID: ${employeeId}).${accessNote}`;
    } catch {
      this.saved = false;
      this.savedMessage = '';
    }
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
      .filter((user) => user.director === 'Yes')
      .map((user) => user.fullName);
    const fallback = [this.adminData.manager, this.adminData.managerLevel2, this.adminData.managerLevel3]
      .filter((name) => !!name)
      .map((name) => name as string);
    return Array.from(new Set([...options, ...fallback]));
  }

  async loadTeams() {
    try {
      this.teams = await firstValueFrom(this.api.getTeams());
      if (!this.adminData.department && this.teams.length) {
        this.adminData.department = this.teams[0].name;
      }
    } catch {
      this.teams = [];
    }
  }

  async loadUsers() {
    try {
      this.users = await firstValueFrom(this.api.getUsers());
    } catch {
      this.users = [];
    }
  }

  async loadProfile() {
    try {
      const profile = await firstValueFrom(this.api.getEmployeeProfile());
      if (profile) {
        this.adminData = { ...this.adminData, ...profile };
        if (!this.adminData.department && this.teams.length) {
          this.adminData.department = this.teams[0].name;
        }
      }
    } catch {
      return;
    }
  }

  async createUserFromProfile() {
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
      director: this.adminData.director,
      password: this.createPassword
    };
    try {
      const saved = await firstValueFrom(this.api.createUser(newUser));
      const existsIndex = this.users.findIndex((user) => user.email === saved.email);
      if (existsIndex >= 0) {
        this.users = this.users.map((user, index) => (index === existsIndex ? saved : user));
      } else {
        this.users = [saved, ...this.users];
      }
      this.userStatus = 'User created.';
      this.createPassword = '';
    } catch {
      this.userStatus = 'Unable to create user. Check for duplicate emails.';
    }
  }

  updateUserRole(_index: number, _role: 'Employee' | 'Manager' | 'Admin' | 'Superadmin') {
    return;
  }

  async updateUser(user: UserRecord) {
    const updated = await firstValueFrom(
      this.api.updateUser(user.id, {
        fullName: user.fullName,
        email: user.email,
        department: user.department,
        role: user.role,
        status: user.status,
        director: user.director
      })
    );
    this.users = this.users.map((item) => (item.id === updated.id ? updated : item));
  }

  async deactivateUser(index: number) {
    const user = this.users[index];
    if (!user) {
      return;
    }
    const confirmed = window.confirm(`Deactivate ${user.fullName}?`);
    if (!confirmed) {
      return;
    }
    try {
      const updated = await firstValueFrom(
        this.api.updateUser(user.id, {
          fullName: user.fullName,
          email: user.email,
          department: user.department,
          role: user.role,
          status: 'Deactivated',
          director: user.director
        })
      );
      this.users = this.users.map((item) => (item.id === updated.id ? updated : item));
      this.userStatus = 'User deactivated.';
    } catch {
      this.userStatus = 'Unable to deactivate user.';
    }
  }

  openEditUser(index: number) {
    const user = this.users[index];
    if (!user) {
      return;
    }
    this.editIndex = index;
    this.editUser = {
      ...user,
      director: user.director ?? 'No'
    };
    this.editPassword = '';
  }

  closeEditUser() {
    this.editIndex = null;
  }

  async saveEditUser() {
    if (this.editIndex === null) {
      return;
    }
    const target = this.users[this.editIndex];
    if (!target) {
      return;
    }
    try {
      const updated = await firstValueFrom(
        this.api.updateUser(target.id, {
          fullName: this.editUser.fullName,
          email: this.editUser.email,
          department: this.editUser.department,
          role: target.role,
          status: this.editUser.status,
          director: this.editUser.director
        })
      );
      this.users = this.users.map((user) => (user.id === updated.id ? updated : user));
      this.userStatus = 'User updated.';
      this.closeEditUser();
    } catch {
      this.userStatus = 'Unable to update user.';
    }
  }

  async persistProfile() {
    try {
      await firstValueFrom(this.api.saveEmployeeProfile(this.adminData as EmployeeProfile));
    } catch {
      return;
    }
  }

  async assignTasks() {
    const tasks = [
      {
        key: 'Offer letter signed',
        owner: this.adminData.checklistOfferOwner
      },
      {
        key: 'Equipment provisioned',
        owner: this.adminData.checklistEquipmentOwner
      },
      {
        key: 'Access badges issued',
        owner: this.adminData.checklistBadgesOwner
      },
      {
        key: 'Orientation scheduled',
        owner: this.adminData.checklistOrientationOwner
      },
      {
        key: 'Provide business card',
        owner: this.adminData.checklistBusinessCardOwner
      }
    ];
    const customTasks = this.adminData.checklistCustom.map((item) => ({
      key: item.title,
      owner: item.owner
    }));
    const payload = tasks
      .filter((task) => task.owner)
      .concat(customTasks.filter((task) => task.owner && task.key))
      .map((task) => ({
        title: `Onboarding: ${task.key}`,
        owner: task.owner as string,
        due: 'This week',
        source: 'onboarding'
      }));

    if (!payload.length) {
      this.taskStatus = 'Select managers before assigning tasks.';
      return;
    }

    try {
      await Promise.all(payload.map((task) => firstValueFrom(this.api.createTask(task))));
      this.taskStatus = `Assigned ${payload.length} tasks.`;
    } catch {
      this.taskStatus = 'Unable to assign tasks.';
    }
  }

  addChecklistItem() {
    const title = this.newChecklistItem.title.trim();
    const owner = this.newChecklistItem.owner.trim();
    if (!title) {
      return;
    }
    this.adminData.checklistCustom = [
      ...this.adminData.checklistCustom,
      { title, owner, done: false }
    ];
    this.newChecklistItem = { title: '', owner: '' };
    this.persistProfile();
  }

  removeChecklistItem(index: number) {
    this.adminData.checklistCustom = this.adminData.checklistCustom.filter((_, i) => i !== index);
    this.persistProfile();
  }
}
