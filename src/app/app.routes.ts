import { Routes } from '@angular/router';
import { HomeComponent } from './home/home.component';
import { PeopleProfileComponent } from './people-profile/people-profile.component';
import { AdminComponent } from './admin/admin.component';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'people/:id', component: PeopleProfileComponent },
  { path: 'admin', component: AdminComponent },
  { path: '**', redirectTo: '' }
];
