import { Injectable, NotFoundException } from '@nestjs/common';
import { EmployeeStatus } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { VaultStorageService } from '../vault/vault-storage.service';
import {
  OrgChartEntity,
  OrgChartNeighbourhoodEntity,
  OrgChartNodeEntity,
} from './entities/org-chart.entity';

/**
 * The reporting-structure read model — a pure visualisation layer over the
 * Employee.reportingManagerId self-relation and the photoStorageKey that
 * onboarding already captures. It adds NO fields and NO relations; it only
 * reads.
 *
 * Two views, one mapper:
 *   - companyChart()      the whole hierarchy (flat nodes + root ids)
 *   - neighbourhood(id)   manager / employee / direct reports for one profile
 *
 * Both go through toNode(), so a node means exactly the same thing on a
 * profile's mini chart as on the full-company page.
 *
 * Access: reporting structure is standard organisational information, so the
 * controller opens both routes to every authenticated employee (the same
 * audience as /employees/search, whose shape this deliberately mirrors). No
 * per-caller filtering happens here.
 *
 * Only ACTIVE employees are part of a chart. A person whose recorded manager is
 * not ACTIVE has their reportingManagerId reported as null, which is what makes
 * them a root — so "root" has a single definition (`reportingManagerId === null`)
 * that no caller has to re-derive.
 */
@Injectable()
export class OrgChartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: VaultStorageService,
  ) {}

  /** The whole company. Small-N by nature (one row per employee, no relations). */
  async companyChart(): Promise<OrgChartEntity> {
    const rows = await this.loadRows({ status: EmployeeStatus.ACTIVE });
    const visible = new Set(rows.map((row) => row.id));
    const [photos, counts] = await Promise.all([
      this.signPhotos(rows),
      this.directReportCounts(rows.map((row) => row.id)),
    ]);

    const nodes = rows.map((row) =>
      this.toNode(row, {
        photos,
        counts,
        // A manager who is not in the visible set cannot be drawn above this
        // person, so within this chart they have none.
        managerId:
          row.reportingManagerId && visible.has(row.reportingManagerId)
            ? row.reportingManagerId
            : null,
      }),
    );

    return new OrgChartEntity({
      nodes,
      rootIds: nodes
        .filter((node) => node.reportingManagerId === null)
        .map((node) => node.id),
    });
  }

  /**
   * The three rows a profile page draws. The subject is loaded regardless of
   * status (a deactivated employee's profile still renders), while the manager
   * above and the reports below are ACTIVE-only, matching the full chart.
   */
  async neighbourhood(
    employeeId: string,
  ): Promise<OrgChartNeighbourhoodEntity> {
    const [subject] = await this.loadRows({ id: employeeId });
    if (!subject) {
      throw new NotFoundException('Employee not found');
    }

    const [manager, reports] = await Promise.all([
      subject.reportingManagerId
        ? this.loadRows({
            id: subject.reportingManagerId,
            status: EmployeeStatus.ACTIVE,
          }).then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      this.loadRows({
        reportingManagerId: subject.id,
        status: EmployeeStatus.ACTIVE,
      }),
    ]);

    const rows = [subject, ...(manager ? [manager] : []), ...reports];
    const [photos, counts] = await Promise.all([
      this.signPhotos(rows),
      this.directReportCounts(rows.map((row) => row.id)),
    ]);

    return new OrgChartNeighbourhoodEntity({
      // The manager row is the top of THIS view — whatever is above them is not
      // part of it — so their in-chart manager is null, same field meaning as
      // everywhere else.
      manager: manager
        ? this.toNode(manager, { photos, counts, managerId: null })
        : null,
      employee: this.toNode(subject, {
        photos,
        counts,
        // Same rule as the full chart: an inactive manager is no manager here.
        managerId: manager ? manager.id : null,
      }),
      reports: reports.map((row) =>
        this.toNode(row, { photos, counts, managerId: subject.id }),
      ),
    });
  }

  /**
   * The one query shape behind both views — inlined select so the row type is
   * inferred, and so the two views can never drift on which columns a node is
   * allowed to carry.
   */
  private loadRows(where: {
    id?: string;
    status?: EmployeeStatus;
    reportingManagerId?: string;
  }) {
    return this.prisma.employee.findMany({
      where,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      select: {
        id: true,
        employeeId: true,
        firstName: true,
        lastName: true,
        email: true,
        designation: true,
        reportingManagerId: true,
        photoStorageKey: true,
        vertical: { select: { name: true } },
      },
    });
  }

  /** Active direct reports per manager id, in one grouped query. */
  private async directReportCounts(
    managerIds: string[],
  ): Promise<Map<string, number>> {
    if (managerIds.length === 0) {
      return new Map();
    }
    const grouped = await this.prisma.employee.groupBy({
      by: ['reportingManagerId'],
      where: {
        status: EmployeeStatus.ACTIVE,
        reportingManagerId: { in: managerIds },
      },
      _count: { _all: true },
    });
    return new Map(
      grouped
        .filter((g) => g.reportingManagerId)
        .map((g) => [g.reportingManagerId as string, g._count._all]),
    );
  }

  /**
   * Signed photo URLs by employee id. Presigning is local (an HMAC, no network
   * round-trip), so signing one per node is cheap. Storage being unconfigured or
   * a signing failure yields no entry rather than an error — the node then falls
   * back to initials, which is the same outcome as "no photo uploaded".
   */
  private async signPhotos(
    rows: { id: string; photoStorageKey: string | null }[],
  ): Promise<Map<string, string>> {
    const withPhotos = rows.filter((row) => row.photoStorageKey);
    if (withPhotos.length === 0 || !this.storage.isConfigured()) {
      return new Map();
    }
    const signed = await Promise.all(
      withPhotos.map(async (row) => {
        try {
          const { url } = await this.storage.createDownloadUrl(
            row.photoStorageKey as string,
          );
          return [row.id, url] as [string, string];
        } catch {
          return null;
        }
      }),
    );
    return new Map(
      signed.filter((entry): entry is [string, string] => !!entry),
    );
  }

  private toNode(
    row: {
      id: string;
      employeeId: string;
      firstName: string;
      lastName: string;
      email: string;
      designation: string | null;
      reportingManagerId: string | null;
      photoStorageKey: string | null;
      vertical: { name: string } | null;
    },
    ctx: {
      photos: Map<string, string>;
      counts: Map<string, number>;
      managerId: string | null;
    },
  ): OrgChartNodeEntity {
    return new OrgChartNodeEntity({
      id: row.id,
      employeeId: row.employeeId,
      firstName: row.firstName,
      lastName: row.lastName,
      fullName: `${row.firstName} ${row.lastName}`.trim(),
      designation: row.designation,
      verticalName: row.vertical?.name ?? null,
      email: row.email,
      reportingManagerId: ctx.managerId,
      directReportCount: ctx.counts.get(row.id) ?? 0,
      photoUrl: ctx.photos.get(row.id) ?? null,
    });
  }
}
