import { ApiProperty } from '@nestjs/swagger';

/**
 * One person in the org chart. Deliberately lean — the same directory-level
 * fields the (all-roles) employee search already exposes, plus the reporting
 * link, a direct-report count and a short-lived signed photo URL. No roles,
 * status, compensation or any other column the HR/Admin-gated roster protects,
 * so this shape is safe for the company-wide chart.
 */
export class OrgChartNodeEntity {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  employeeId!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ description: 'Full display name (firstName + lastName)' })
  fullName!: string;

  @ApiProperty({ nullable: true, description: 'Job title, if recorded' })
  designation!: string | null;

  @ApiProperty({ nullable: true })
  verticalName!: string | null;

  @ApiProperty()
  email!: string;

  @ApiProperty({
    nullable: true,
    description:
      'Manager within THIS chart. Normalised to null when the recorded manager is not part of the visible set (deactivated or missing), which is exactly what makes this node a root — callers never have to re-derive that rule.',
  })
  reportingManagerId!: string | null;

  @ApiProperty({ description: 'Active direct reports of this person' })
  directReportCount!: number;

  @ApiProperty({
    nullable: true,
    description:
      'Short-lived signed GET URL for the employee photo; null when they have no photo (render initials) or when storage is unavailable.',
  })
  photoUrl!: string | null;

  constructor(partial: Partial<OrgChartNodeEntity>) {
    Object.assign(this, partial);
  }
}

/** The whole company hierarchy as a flat node list plus its root ids. */
export class OrgChartEntity {
  @ApiProperty({ type: [OrgChartNodeEntity] })
  nodes!: OrgChartNodeEntity[];

  @ApiProperty({
    type: [String],
    description:
      'Ids of the nodes with no manager inside the chart (CEO/top of company, and anyone whose manager is deactivated).',
  })
  rootIds!: string[];

  constructor(partial: Partial<OrgChartEntity>) {
    Object.assign(this, partial);
  }
}

/**
 * The three rows a profile page's mini chart draws: the manager above, the
 * profile owner in the middle, their direct reports below.
 */
export class OrgChartNeighbourhoodEntity {
  @ApiProperty({
    type: OrgChartNodeEntity,
    nullable: true,
    description: 'null for top-of-company employees — no manager row is drawn.',
  })
  manager!: OrgChartNodeEntity | null;

  @ApiProperty({ type: OrgChartNodeEntity })
  employee!: OrgChartNodeEntity;

  @ApiProperty({ type: [OrgChartNodeEntity] })
  reports!: OrgChartNodeEntity[];

  constructor(partial: Partial<OrgChartNeighbourhoodEntity>) {
    Object.assign(this, partial);
  }
}
