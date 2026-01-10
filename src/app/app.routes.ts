import { inject } from '@angular/core';
import { CanActivateFn, Routes, Router } from '@angular/router';
import { HomeComponent } from './home/home.component';

const authGuard: CanActivateFn = () => {
  const router = inject(Router);
  const raw = localStorage.getItem('tx-peoplehub-session');
  if (!raw) {
    return router.parseUrl('/login');
  }
  try {
    const parsed = JSON.parse(raw) as { email?: string };
    if (!parsed.email) {
      return router.parseUrl('/login');
    }
  } catch {
    return router.parseUrl('/login');
  }
  return true;
};

const directorGuard: CanActivateFn = () => {
  const router = inject(Router);
  const raw = localStorage.getItem('tx-peoplehub-session');
  if (!raw) {
    return router.parseUrl('/login');
  }
  try {
    const parsed = JSON.parse(raw) as { director?: string };
    if (parsed.director !== 'Yes') {
      return router.parseUrl('/');
    }
  } catch {
    return router.parseUrl('/');
  }
  return true;
};

const adminGuard: CanActivateFn = () => {
  const router = inject(Router);
  const raw = localStorage.getItem('tx-peoplehub-session');
  if (!raw) {
    return router.parseUrl('/login');
  }
  try {
    const parsed = JSON.parse(raw) as { role?: string };
    const role = parsed.role?.trim().toLowerCase();
    if (role !== 'admin' && role !== 'superadmin') {
      return router.parseUrl('/');
    }
  } catch {
    return router.parseUrl('/');
  }
  return true;
};

export const routes: Routes = [
  { path: '', component: HomeComponent, canActivate: [authGuard] },
  {
    path: 'people',
    loadComponent: () =>
      import('./people-directory/people-directory.component').then(
        (m) => m.PeopleDirectoryComponent
      ),
    canActivate: [authGuard]
  },
  {
    path: 'financials',
    loadComponent: () =>
      import('./financials/financials.component').then((m) => m.FinancialsComponent),
    canActivate: [authGuard]
  },
  {
    path: 'tasks',
    loadComponent: () => import('./tasks/tasks.component').then((m) => m.TasksComponent),
    canActivate: [authGuard]
  },
  {
    path: 'reimbursement',
    loadComponent: () =>
      import('./reimbursement/reimbursement.component').then((m) => m.ReimbursementComponent),
    canActivate: [authGuard]
  },
  {
    path: 'reimbursement/new',
    loadComponent: () =>
      import('./reimbursement-form/reimbursement-form.component').then(
        (m) => m.ReimbursementFormComponent
      ),
    canActivate: [authGuard]
  },
  {
    path: 'performance',
    loadComponent: () =>
      import('./performance/performance.component').then((m) => m.PerformanceComponent),
    canActivate: [authGuard]
  },
  {
    path: 'compliance-training',
    loadComponent: () =>
      import('./compliance-training/compliance-training.component').then(
        (m) => m.ComplianceTrainingComponent
      ),
    canActivate: [authGuard]
  },
  {
    path: 'compliance-training/:title',
    loadComponent: () =>
      import('./training-module/training-module.component').then(
        (m) => m.TrainingModuleComponent
      ),
    canActivate: [authGuard]
  },
  {
    path: 'admin/assign-training',
    loadComponent: () =>
      import('./assign-training/assign-training.component').then(
        (m) => m.AssignTrainingComponent
      ),
    canActivate: [authGuard]
  },
  {
    path: 'login',
    loadComponent: () => import('./login/login.component').then((m) => m.LoginComponent)
  },
  {
    path: 'workforce-planning',
    loadComponent: () =>
      import('./workforce-planning/workforce-planning.component').then(
        (m) => m.WorkforcePlanningComponent
      ),
    canActivate: [authGuard, directorGuard]
  },
  {
    path: 'approvals',
    loadComponent: () =>
      import('./approvals/approvals.component').then((m) => m.ApprovalsComponent),
    canActivate: [authGuard]
  },
  {
    path: 'org-structure',
    loadComponent: () =>
      import('./org-structure/org-structure.component').then((m) => m.OrgStructureComponent),
    canActivate: [authGuard]
  },
  {
    path: 'people/:id',
    loadComponent: () =>
      import('./people-profile/people-profile.component').then(
        (m) => m.PeopleProfileComponent
      ),
    canActivate: [authGuard]
  },
  {
    path: 'people/:id/scorecard',
    loadComponent: () =>
      import('./scorecard/scorecard.component').then((m) => m.ScorecardComponent),
    canActivate: [authGuard]
  },
  {
    path: 'admin',
    loadComponent: () => import('./admin/admin.component').then((m) => m.AdminComponent),
    canActivate: [authGuard, adminGuard]
  },
  {
    path: 'settings',
    loadComponent: () => import('./settings/settings.component').then((m) => m.SettingsComponent),
    canActivate: [authGuard, adminGuard]
  },
  { path: '**', redirectTo: '' }
];
