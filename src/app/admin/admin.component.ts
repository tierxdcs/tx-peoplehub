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
  showOnboardModal = false;
  teams: TeamRecord[] = [];
  userStatus = '';
  taskStatus = '';
  users: UserRecord[] = [];
  directors: UserRecord[] = [];
  private readonly userPageSize = 25;
  private userOffset = 0;
  hasMoreUsers = true;
  isLoadingUsers = false;
  editIndex: number | null = null;
  editingUser: UserRecord | null = null;
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
  adminData = this.createEmptyAdminData();
  newChecklistItem = { title: '', owner: '' };

  constructor(private readonly api: ApiService) {}

  async ngOnInit() {
    await Promise.all([this.loadTeams(), this.loadUsers(true), this.loadDirectors(), this.loadProfile()]);
  }

  async save(event: Event) {
    event.preventDefault();
    const form = event.target as HTMLFormElement | null;
    if (!form || !form.reportValidity()) {
      this.saved = false;
      return;
    }
    if (await this.isDuplicateEmail()) {
      this.saved = false;
      this.userStatus = 'Email already exists. Use a different email.';
      return;
    }

    try {
      const saved = await firstValueFrom(this.api.saveEmployeeProfile(this.adminData as EmployeeProfile));
      this.adminData = { ...this.adminData, ...this.normalizeProfileDates(saved) };
      this.saved = true;
      const name = this.adminData.fullName?.trim() || 'Employee';
      const employeeId = this.adminData.employeeId?.trim() || 'N/A';
      let accessNote = '';
      let taskNote = '';
      if (this.adminData.fullName && this.adminData.email) {
        try {
          const userPayload = {
            fullName: this.adminData.fullName.trim(),
            email: this.adminData.email.trim(),
            department: this.adminData.department,
            role: (this.adminData.role || 'Employee') as
              | 'Employee'
              | 'Manager'
              | 'Admin'
              | 'Superadmin',
            status: (this.adminData.status === 'Active' || !this.adminData.status
              ? 'Active'
              : 'Deactivated') as 'Active' | 'Deactivated',
            director: this.adminData.director || 'No',
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
        const taskResult = await this.assignTasks();
        if (taskResult?.message) {
          this.taskStatus = taskResult.message;
          taskNote = ` ${taskResult.message}`;
        }
      }
      const baseMessage = this.editingUser ? 'Profile updated' : 'Onboarding completed';
      this.savedMessage = `${baseMessage} for ${name} (ID: ${employeeId}).${accessNote}${taskNote}`;
      this.showOnboardModal = true;
    } catch {
      this.saved = false;
      this.savedMessage = '';
      this.showOnboardModal = false;
    }
  }

  private async isDuplicateEmail() {
    const email = this.adminData.email?.trim().toLowerCase();
    if (!email) {
      return false;
    }
    if (this.editingUser && this.editingUser.email?.trim().toLowerCase() === email) {
      return false;
    }
    try {
      const users = await firstValueFrom(this.api.getUsers({ search: email, limit: 5 }));
      return users.some((user) => user.email?.trim().toLowerCase() === email);
    } catch {
      return false;
    }
  }

  closeOnboardModal() {
    this.showOnboardModal = false;
  }

  cancelEditProfile() {
    this.editingUser = null;
    this.adminData = this.createEmptyAdminData();
    this.createPassword = '';
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
    const options = this.users.map((user) => user.fullName).filter(Boolean);
    const fallback = [
      this.adminData.manager,
      this.adminData.managerLevel2,
      this.adminData.managerLevel3,
      this.adminData.managerLevel4,
      this.adminData.ceo
    ]
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

  private async loadUsersPage() {
    try {
      if (this.isLoadingUsers) {
        return;
      }
      this.isLoadingUsers = true;
      const users = await firstValueFrom(
        this.api.getUsers({ limit: this.userPageSize, offset: this.userOffset })
      );
      if (this.userOffset === 0) {
        this.users = users;
      } else {
        this.users = [...this.users, ...users];
      }
      this.hasMoreUsers = users.length === this.userPageSize;
      this.isLoadingUsers = false;
    } catch {
      this.isLoadingUsers = false;
      this.users = [];
    }
  }

  async loadUsers(reset = false) {
    if (reset) {
      this.userOffset = 0;
      this.users = [];
      this.hasMoreUsers = true;
    }
    await this.loadUsersPage();
  }

  async loadDirectors() {
    try {
      this.directors = await firstValueFrom(this.api.getUsers({ director: 'Yes', limit: 200 }));
    } catch {
      this.directors = [];
    }
  }

  loadMoreUsers() {
    if (!this.hasMoreUsers || this.isLoadingUsers) {
      return;
    }
    this.userOffset += this.userPageSize;
    void this.loadUsersPage();
  }

  private syncDirectors(user: UserRecord) {
    const existsIndex = this.directors.findIndex((item) => item.id === user.id);
    if (user.director === 'Yes') {
      if (existsIndex >= 0) {
        this.directors = this.directors.map((item, index) =>
          index === existsIndex ? user : item
        );
      } else {
        this.directors = [user, ...this.directors];
      }
    } else if (existsIndex >= 0) {
      this.directors = this.directors.filter((item) => item.id !== user.id);
    }
  }

  async loadProfile() {
    try {
      const profile = await firstValueFrom(this.api.getEmployeeProfile());
      if (profile) {
        this.adminData = { ...this.adminData, ...this.normalizeProfileDates(profile) };
        if (!this.adminData.department && this.teams.length) {
          this.adminData.department = this.teams[0].name;
        }
      }
    } catch {
      return;
    }
  }

  private normalizeProfileDates(profile: Partial<EmployeeProfile>) {
    const toInputDate = (value: string | undefined) => {
      if (!value) {
        return '';
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return value;
      }
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        return '';
      }
      return parsed.toISOString().slice(0, 10);
    };
    return {
      ...profile,
      startDate: toInputDate(profile.startDate),
      compensationEffectiveDate: toInputDate(profile.compensationEffectiveDate),
      policyEffective: toInputDate(profile.policyEffective),
      nextAuditDate: toInputDate(profile.nextAuditDate)
    };
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
      this.syncDirectors(saved);
      this.userStatus = 'User created.';
      this.createPassword = '';
    } catch {
      this.userStatus = 'Unable to create user. Check for duplicate emails.';
    }
  }

  updateUserRole(_index: number, _role: 'Employee' | 'Manager' | 'Admin' | 'Superadmin') {
    return;
  }

  async editEmployeeProfile(index: number) {
    const user = this.users[index];
    if (!user) {
      return;
    }
    this.editingUser = user;
    try {
      const profile = await firstValueFrom(
        this.api.getEmployeeProfile({ email: user.email })
      );
      if (profile) {
        this.adminData = {
          ...this.createEmptyAdminData(),
          ...this.normalizeProfileDates(profile),
          role: profile.role || user.role,
          status: profile.status || user.status,
          director: profile.director || user.director || 'No'
        };
      } else {
        this.adminData = {
          ...this.createEmptyAdminData(),
          fullName: user.fullName,
          email: user.email,
          department: user.department,
          role: user.role,
          status: user.status,
          director: user.director || 'No'
        };
      }
    } catch {
      this.adminData = {
        ...this.createEmptyAdminData(),
        fullName: user.fullName,
        email: user.email,
        department: user.department,
        role: user.role,
        status: user.status,
        director: user.director || 'No'
      };
    }
    this.createPassword = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
    this.syncDirectors(updated);
  }

  async resetPassword(index: number) {
    const user = this.users[index];
    if (!user) {
      return;
    }
    const nextPassword = window.prompt(
      `Set a new temporary password for ${user.fullName}.`
    );
    if (!nextPassword) {
      return;
    }
    try {
      await firstValueFrom(
        this.api.updateUser(user.id, {
          fullName: user.fullName,
          email: user.email,
          department: user.department,
          role: user.role,
          status: user.status,
          director: user.director,
          password: nextPassword
        })
      );
      this.userStatus = 'Password reset.';
    } catch {
      this.userStatus = 'Unable to reset password.';
    }
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
      this.syncDirectors(updated);
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
          director: this.editUser.director,
          password: this.editPassword || undefined
        })
      );
      this.users = this.users.map((user) => (user.id === updated.id ? updated : user));
      this.syncDirectors(updated);
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
        owner: this.adminData.checklistOfferOwner,
        enabled: this.adminData.checklistOffer
      },
      {
        key: 'Equipment provisioned',
        owner: this.adminData.checklistEquipmentOwner,
        enabled: this.adminData.checklistEquipment
      },
      {
        key: 'Access badges issued',
        owner: this.adminData.checklistBadgesOwner,
        enabled: this.adminData.checklistBadges
      },
      {
        key: 'Orientation scheduled',
        owner: this.adminData.checklistOrientationOwner,
        enabled: this.adminData.checklistOrientation
      },
      {
        key: 'Provide business card',
        owner: this.adminData.checklistBusinessCardOwner,
        enabled: this.adminData.checklistBusinessCard
      }
    ];
    const customTasks = this.adminData.checklistCustom.map((item) => ({
      key: item.title,
      owner: item.owner,
      enabled: !item.done
    }));
    const payload = tasks
      .filter((task) => task.owner && task.enabled)
      .concat(customTasks.filter((task) => task.owner && task.key && task.enabled))
      .map((task) => ({
        title: `Onboarding: ${task.key}`,
        owner: task.owner as string,
        ownerEmail: this.lookupOwnerEmail(task.owner as string),
        due: 'This week',
        source: 'onboarding'
      }));

    if (!payload.length) {
      return { assigned: 0, message: 'Select managers before assigning tasks.' };
    }

    try {
      await Promise.all(payload.map((task) => firstValueFrom(this.api.createTask(task))));
      return { assigned: payload.length, message: `Assigned ${payload.length} tasks.` };
    } catch {
      return { assigned: 0, message: 'Unable to assign tasks.' };
    }
  }

  lookupOwnerEmail(ownerName: string) {
    return this.users.find((user) => user.fullName === ownerName)?.email ?? '';
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

  private createEmptyAdminData() {
    return {
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
      variablePayPercent: '',
      paySchedule: 'Bi-weekly',
      bonusEligible: 'Yes',
      equityPlan: 'Not eligible',
      benefitsTier: 'Standard',
      medicalStatus: 'N/A',
      dentalStatus: 'N/A',
      visionStatus: 'N/A',
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
  }
}
