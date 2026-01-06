import { Routes } from '@angular/router';
import { HomeComponent } from './home/home.component';
import { PeopleProfileComponent } from './people-profile/people-profile.component';
import { AdminComponent } from './admin/admin.component';
import { ScorecardComponent } from './scorecard/scorecard.component';
import { TeamsComponent } from './teams/teams.component';
import { SettingsComponent } from './settings/settings.component';
import { PeopleDirectoryComponent } from './people-directory/people-directory.component';
import { TasksComponent } from './tasks/tasks.component';
import { FinancialsComponent } from './financials/financials.component';
import { PerformanceComponent } from './performance/performance.component';
import { CompensationComponent } from './compensation/compensation.component';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'teams', component: TeamsComponent },
  { path: 'people', component: PeopleDirectoryComponent },
  { path: 'financials', component: FinancialsComponent },
  { path: 'compensation', component: CompensationComponent },
  { path: 'tasks', component: TasksComponent },
  { path: 'performance', component: PerformanceComponent },
  { path: 'people/:id', component: PeopleProfileComponent },
  { path: 'people/:id/scorecard', component: ScorecardComponent },
  { path: 'admin', component: AdminComponent },
  { path: 'settings', component: SettingsComponent },
  { path: '**', redirectTo: '' }
];
