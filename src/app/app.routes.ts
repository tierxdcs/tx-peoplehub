import { Routes } from '@angular/router';
import { HomeComponent } from './home/home.component';
import { PeopleProfileComponent } from './people-profile/people-profile.component';
import { AdminComponent } from './admin/admin.component';
import { ScorecardComponent } from './scorecard/scorecard.component';
import { TeamsComponent } from './teams/teams.component';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'teams', component: TeamsComponent },
  { path: 'people/:id', component: PeopleProfileComponent },
  { path: 'people/:id/scorecard', component: ScorecardComponent },
  { path: 'admin', component: AdminComponent },
  { path: '**', redirectTo: '' }
];
