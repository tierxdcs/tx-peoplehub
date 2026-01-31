import { Component, HostListener, OnDestroy } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil, firstValueFrom } from 'rxjs';
import { ApiService, TrainingAssignment } from './services/api.service';
import { LoadingService } from './services/loading.service';

type NotificationItem = {
  id: string;
  title: string;
  source: string;
  due: string;
};

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnDestroy {
  notificationsOpen = false;
  showChrome = true;
  avatarOpen = false;
  isLoading = false;
  notifications: NotificationItem[] = [];
  notificationsCount = 0;
  showPasswordModal = false;
  passwordSaving = false;
  passwordForm = {
    current: '',
    next: '',
    confirm: ''
  };
  passwordError = '';
  passwordMessage = '';
  private readonly destroy$ = new Subject<void>();
  session = {
    name: 'Alex Taylor',
    role: 'HR Operations',
    email: 'hr@tierx.com',
    director: 'No',
    department: 'Operations',
    jobTitle: ''
  };
  isAdmin = false;
  lastRoute = '';

  constructor(
    private readonly router: Router,
    private readonly loading: LoadingService,
    private readonly api: ApiService
  ) {}

  async ngOnInit() {
    this.lastRoute = sessionStorage.getItem('tx-peoplehub-last-route') || '';
    this.loadSession();
    this.loading.isLoading$.pipe(takeUntil(this.destroy$)).subscribe((state) => {
      this.isLoading = state;
    });
    this.isAdmin = false;
    await this.refreshSessionFromDb();
    void this.loadNotifications();
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        sessionStorage.setItem('tx-peoplehub-prev-route', this.lastRoute);
        this.lastRoute = event.urlAfterRedirects;
        sessionStorage.setItem('tx-peoplehub-last-route', this.lastRoute);
        this.showChrome = !event.urlAfterRedirects.startsWith('/login');
        this.loadSession();
        this.isAdmin = false;
        void this.refreshSessionFromDb().then(() => this.loadNotifications());
      }
    });
  }

  logout() {
    this.notificationsOpen = false;
    this.avatarOpen = false;
    localStorage.removeItem('tx-peoplehub-session');
    this.router.navigateByUrl('/login');
  }

  toggleAvatarMenu() {
    this.avatarOpen = !this.avatarOpen;
    if (this.avatarOpen) {
      this.notificationsOpen = false;
    }
  }

  openPasswordModal() {
    this.avatarOpen = false;
    this.notificationsOpen = false;
    this.passwordError = '';
    this.passwordMessage = '';
    this.passwordForm = {
      current: '',
      next: '',
      confirm: ''
    };
    this.showPasswordModal = true;
  }

  closePasswordModal() {
    this.showPasswordModal = false;
    this.passwordSaving = false;
    this.passwordError = '';
    this.passwordMessage = '';
  }

  async submitPasswordChange() {
    if (this.passwordSaving) {
      return;
    }
    const email = this.session.email?.trim().toLowerCase();
    if (!email) {
      this.passwordError = 'Unable to identify your account. Please log in again.';
      return;
    }
    if (!this.passwordForm.current || !this.passwordForm.next || !this.passwordForm.confirm) {
      this.passwordError = 'Please fill out all password fields.';
      return;
    }
    if (this.passwordForm.next !== this.passwordForm.confirm) {
      this.passwordError = 'New password entries do not match.';
      return;
    }
    this.passwordSaving = true;
    this.passwordError = '';
    this.passwordMessage = '';
    try {
      await firstValueFrom(
        this.api.changePassword({
          email,
          currentPassword: this.passwordForm.current,
          newPassword: this.passwordForm.next
        })
      );
      this.passwordMessage = 'Password updated successfully.';
      this.passwordForm = { current: '', next: '', confirm: '' };
    } catch {
      this.passwordError = 'Unable to update password. Please verify your current password.';
    } finally {
      this.passwordSaving = false;
    }
  }

  toggleNotifications() {
    this.notificationsOpen = !this.notificationsOpen;
    if (this.notificationsOpen) {
      this.avatarOpen = false;
    }
  }

  async loadNotifications() {
    if (!this.session.email || !this.showChrome) {
      this.notifications = [];
      this.notificationsCount = 0;
      return;
    }
    try {
      const sessionEmail = this.session.email.toLowerCase();
      const sessionName = this.session.name.trim();
      const isDirector = this.session.director.trim().toLowerCase() === 'yes';
      const isCoo = sessionName.toLowerCase() === 'ravi kulal';
      const [tasks, assignments, responses, leaves, reimbursements, requisitions] =
        await Promise.all([
          firstValueFrom(this.api.getTasks({ ownerEmail: sessionEmail, limit: 6 })),
          firstValueFrom(this.api.getTrainingAssignments({ limit: 50 })),
          firstValueFrom(this.api.getTrainingResponses({ employee: sessionName, limit: 50 })),
          sessionName
            ? firstValueFrom(this.api.getLeaves({ managerName: sessionName, limit: 10 }))
            : Promise.resolve([]),
          isCoo
            ? firstValueFrom(this.api.getReimbursements({ scope: 'all', limit: 10 }))
            : Promise.resolve([]),
          isDirector
            ? firstValueFrom(this.api.getRequisitions({ scope: 'all', limit: 10 }))
            : Promise.resolve([])
        ]);

      const completedAssignments = new Set(
        responses.filter((entry) => entry.passed).map((entry) => entry.assignmentId)
      );
      const trainingItems = this.filterTrainingAssignments(
        assignments,
        this.session.department,
        this.session.role
      ).filter((assignment) => !completedAssignments.has(assignment.id));

      const notices: NotificationItem[] = [
        ...tasks.map((task) => ({
          id: task.id,
          title: task.title,
          source: 'Task assigned',
          due: task.due
        })),
        ...trainingItems.map((assignment) => ({
          id: assignment.id,
          title: `Training · ${assignment.title}`,
          source: 'Training assigned',
          due: assignment.dueDate
        })),
        ...leaves
          .filter((request) => request.status?.toLowerCase().includes('pending'))
          .map((request) => ({
            id: request.id,
            title: `Leave request · ${request.type}`,
            source: 'Approval needed',
            due: request.range
          })),
        ...reimbursements
          .filter((request) => request.status?.toLowerCase().includes('pending'))
          .map((request) => ({
            id: request.id,
            title: `Reimbursement · ${request.category}`,
            source: 'COO approval',
            due: request.amount
          })),
        ...requisitions
          .filter((request) => request.approval?.toLowerCase().includes('pending'))
          .map((request) => ({
            id: request.id,
            title: `Requisition · ${request.title}`,
            source: 'Board approval',
            due: `${request.department} · ${request.headcount} headcount`
          }))
      ];
      this.notifications = notices.slice(0, 10);
      this.notificationsCount = this.notifications.length;
    } catch {
      this.notifications = [];
      this.notificationsCount = 0;
    }
  }

  @HostListener('document:click', ['$event'])
  handleDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }
    const actions = target.closest('.actions');
    if (!actions) {
      this.notificationsOpen = false;
      this.avatarOpen = false;
    }
  }

  loadSession() {
    const raw = localStorage.getItem('tx-peoplehub-session');
    if (!raw) {
      this.isAdmin = false;
      return;
    }
    try {
      const parsed = JSON.parse(raw) as {
        name?: string;
        role?: string;
        email?: string;
        director?: string;
        department?: string;
        jobTitle?: string;
      };
      this.session = {
        name: parsed.name?.trim() || this.session.name,
        role: parsed.role?.trim() || this.session.role,
        email: parsed.email?.trim() || this.session.email,
        director: parsed.director?.trim() || this.session.director,
        department: parsed.department?.trim() || this.session.department,
        jobTitle: parsed.jobTitle?.trim() || this.session.jobTitle
      };
      this.isAdmin = false;
    } catch {
      // Keep defaults if session data is malformed.
    }
  }

  get avatarInitials() {
    const tokens = this.session.name.split(' ').filter(Boolean);
    if (!tokens.length) {
      return 'TX';
    }
    const initials = tokens
      .slice(0, 2)
      .map((token) => token[0]?.toUpperCase() ?? '')
      .join('');
    return initials || 'TX';
  }

  private filterTrainingAssignments(
    assignments: TrainingAssignment[],
    department: string,
    role: string
  ) {
    return assignments.filter((assignment) => {
      const assignedDepartment = assignment.department ?? 'All departments';
      const assignedAudience = assignment.audience ?? 'All employees';
      const departmentMatch =
        assignedDepartment === 'All departments' || assignedDepartment === department;
      const audienceMatch = assignedAudience === 'All employees' || assignedAudience === role;
      return departmentMatch && audienceMatch;
    });
  }

  private async refreshSessionFromDb() {
    const email = this.session.email?.trim().toLowerCase();
    if (!email) {
      this.isAdmin = false;
      return;
    }
    try {
      const [users, profile] = await Promise.all([
        firstValueFrom(this.api.getUsers({ search: email, limit: 5 })),
        firstValueFrom(this.api.getEmployeeProfile({ email }))
      ]);
      const match = users.find((user) => user.email?.trim().toLowerCase() === email);
      if (!match) {
        this.isAdmin = false;
        return;
      }
      this.session = {
        ...this.session,
        name: match.fullName || this.session.name,
        role: match.role || this.session.role,
        director: match.director || this.session.director,
        department: match.department || this.session.department,
        jobTitle: profile?.jobTitle || this.session.jobTitle
      };
      const role = this.session.role.trim().toLowerCase();
      this.isAdmin = role === 'admin' || role === 'superadmin';
      const raw = localStorage.getItem('tx-peoplehub-session');
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as {
            role?: string;
            director?: string;
            department?: string;
            name?: string;
            jobTitle?: string;
          };
          parsed.role = this.session.role;
          parsed.director = this.session.director;
          parsed.department = this.session.department;
          parsed.name = this.session.name;
          parsed.jobTitle = this.session.jobTitle;
          localStorage.setItem('tx-peoplehub-session', JSON.stringify(parsed));
        } catch {
          return;
        }
      }
    } catch {
      this.isAdmin = false;
      return;
    }
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
