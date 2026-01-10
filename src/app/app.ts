import { Component, HostListener, OnDestroy } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
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
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
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
  private readonly destroy$ = new Subject<void>();
  session = {
    name: 'Alex Taylor',
    role: 'HR Operations',
    email: 'hr@tierx.com',
    director: 'No',
    department: 'Operations'
  };
  isAdmin = false;

  constructor(
    private readonly router: Router,
    private readonly loading: LoadingService,
    private readonly api: ApiService
  ) {}

  ngOnInit() {
    this.loadSession();
    this.loading.isLoading$.pipe(takeUntil(this.destroy$)).subscribe((state) => {
      this.isLoading = state;
    });
    void this.loadNotifications();
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.showChrome = !event.urlAfterRedirects.startsWith('/login');
        this.loadSession();
        void this.loadNotifications();
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
      const isCfo = sessionName.toLowerCase() === 'ravi kulal';
      const [tasks, assignments, responses, leaves, reimbursements, requisitions] =
        await Promise.all([
          firstValueFrom(this.api.getTasks({ ownerEmail: sessionEmail, limit: 6 })),
          firstValueFrom(this.api.getTrainingAssignments({ limit: 50 })),
          firstValueFrom(this.api.getTrainingResponses({ employee: sessionName, limit: 50 })),
          sessionName
            ? firstValueFrom(this.api.getLeaves({ managerName: sessionName, limit: 10 }))
            : Promise.resolve([]),
          isCfo
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
            source: 'CFO approval',
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
      return;
    }
    try {
      const parsed = JSON.parse(raw) as {
        name?: string;
        role?: string;
        email?: string;
        director?: string;
        department?: string;
      };
      this.session = {
        name: parsed.name?.trim() || this.session.name,
        role: parsed.role?.trim() || this.session.role,
        email: parsed.email?.trim() || this.session.email,
        director: parsed.director?.trim() || this.session.director,
        department: parsed.department?.trim() || this.session.department
      };
      const role = this.session.role.trim().toLowerCase();
      this.isAdmin = role === 'admin' || role === 'superadmin';
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

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
