import { Routes } from '@angular/router';
import { HomeComponent } from './home/home.component';
import { PeopleProfileComponent } from './people-profile/people-profile.component';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'people/:id', component: PeopleProfileComponent },
  { path: '**', redirectTo: '' }
];
