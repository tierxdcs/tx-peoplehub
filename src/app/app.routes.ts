import { Routes } from '@angular/router';
import { HomeComponent } from './home/home.component';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  {
    path: 'people',
    loadComponent: () =>
      import('./people-directory/people-directory.component').then(
        (m) => m.PeopleDirectoryComponent
      )
  },
  {
    path: 'financials',
    loadComponent: () =>
      import('./financials/financials.component').then((m) => m.FinancialsComponent)
  },
  {
    path: 'tasks',
    loadComponent: () => import('./tasks/tasks.component').then((m) => m.TasksComponent)
  },
  {
    path: 'reimbursement',
    loadComponent: () =>
      import('./reimbursement/reimbursement.component').then((m) => m.ReimbursementComponent)
  },
  {
    path: 'reimbursement/new',
    loadComponent: () =>
      import('./reimbursement-form/reimbursement-form.component').then(
        (m) => m.ReimbursementFormComponent
      )
  },
  {
    path: 'performance',
    loadComponent: () =>
      import('./performance/performance.component').then((m) => m.PerformanceComponent)
  },
  {
    path: 'compliance-training',
    loadComponent: () =>
      import('./compliance-training/compliance-training.component').then(
        (m) => m.ComplianceTrainingComponent
      )
  },
  {
    path: 'compliance-training/:title',
    loadComponent: () =>
      import('./training-module/training-module.component').then(
        (m) => m.TrainingModuleComponent
      )
  },
  {
    path: 'admin/assign-training',
    loadComponent: () =>
      import('./assign-training/assign-training.component').then(
        (m) => m.AssignTrainingComponent
      )
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
      )
  },
  {
    path: 'approvals',
    loadComponent: () =>
      import('./approvals/approvals.component').then((m) => m.ApprovalsComponent)
  },
  {
    path: 'org-structure',
    loadComponent: () =>
      import('./org-structure/org-structure.component').then((m) => m.OrgStructureComponent)
  },
  {
    path: 'people/:id',
    loadComponent: () =>
      import('./people-profile/people-profile.component').then(
        (m) => m.PeopleProfileComponent
      )
  },
  {
    path: 'people/:id/scorecard',
    loadComponent: () =>
      import('./scorecard/scorecard.component').then((m) => m.ScorecardComponent)
  },
  {
    path: 'admin',
    loadComponent: () => import('./admin/admin.component').then((m) => m.AdminComponent)
  },
  {
    path: 'settings',
    loadComponent: () => import('./settings/settings.component').then((m) => m.SettingsComponent)
  },
  { path: '**', redirectTo: '' }
];
