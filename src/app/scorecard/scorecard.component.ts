import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

@Component({
  selector: 'app-scorecard',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './scorecard.component.html',
  styleUrl: './scorecard.component.scss'
})
export class ScorecardComponent {
  private readonly route = inject(ActivatedRoute);
  readonly profileId =
    this.route.snapshot.paramMap.get('id') ?? 'current';
  hasScorecard = false;
}
