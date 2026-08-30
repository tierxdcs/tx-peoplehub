import { NotFoundException } from '@nestjs/common';
import { EmployeeStatus } from '@prisma/client';
import { OrgChartService } from './org-chart.service';
import { PrismaService } from '../../core/database/prisma.service';
import { VaultStorageService } from '../vault/vault-storage.service';

/**
 * The org chart is a read-only projection of reportingManagerId, so the fixture
 * is just a people list; the fake findMany/groupBy honour the same where-clauses
 * the service actually sends.
 */
interface Row {
  id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  email: string;
  designation: string | null;
  reportingManagerId: string | null;
  photoStorageKey: string | null;
  status: EmployeeStatus;
  verticalName: string | null;
  // Deliberately present on the fixture but NOT in the node select — proves the
  // service cannot leak columns the roster protects.
  monthlyCtc: number;
}

function row(partial: Partial<Row> & { id: string }): Row {
  return {
    employeeId: `EMP-${partial.id}`,
    firstName: partial.id.toUpperCase(),
    lastName: 'Person',
    email: `${partial.id}@phaze-dynamics.com`,
    designation: null,
    reportingManagerId: null,
    photoStorageKey: null,
    status: EmployeeStatus.ACTIVE,
    verticalName: null,
    monthlyCtc: 100000,
    ...partial,
  };
}

function build(
  rows: Row[],
  storageOverrides: Partial<VaultStorageService> = {},
) {
  const findMany = jest.fn(
    (args: {
      where: {
        id?: string;
        status?: EmployeeStatus;
        reportingManagerId?: string;
      };
    }) => {
      const { where } = args;
      return Promise.resolve(
        rows
          .filter((r) => (where.id === undefined ? true : r.id === where.id))
          .filter((r) =>
            where.status === undefined ? true : r.status === where.status,
          )
          .filter((r) =>
            where.reportingManagerId === undefined
              ? true
              : r.reportingManagerId === where.reportingManagerId,
          )
          .map((r) => ({
            id: r.id,
            employeeId: r.employeeId,
            firstName: r.firstName,
            lastName: r.lastName,
            email: r.email,
            designation: r.designation,
            reportingManagerId: r.reportingManagerId,
            photoStorageKey: r.photoStorageKey,
            vertical: r.verticalName ? { name: r.verticalName } : null,
          })),
      );
    },
  );

  const groupBy = jest.fn(
    (args: { where: { reportingManagerId: { in: string[] } } }) => {
      const ids = args.where.reportingManagerId.in;
      const counts = new Map<string, number>();
      for (const r of rows) {
        if (r.status !== EmployeeStatus.ACTIVE) continue;
        if (!r.reportingManagerId || !ids.includes(r.reportingManagerId))
          continue;
        counts.set(
          r.reportingManagerId,
          (counts.get(r.reportingManagerId) ?? 0) + 1,
        );
      }
      return Promise.resolve(
        [...counts].map(([reportingManagerId, count]) => ({
          reportingManagerId,
          _count: { _all: count },
        })),
      );
    },
  );

  const storage = {
    isConfigured: () => true,
    createDownloadUrl: (key: string) =>
      Promise.resolve({
        url: `https://r2.test/${key}?sig=x`,
        expiresInSeconds: 900,
      }),
    ...storageOverrides,
  } as unknown as VaultStorageService;

  const service = new OrgChartService(
    { employee: { findMany, groupBy } } as unknown as PrismaService,
    storage,
  );
  return { service, findMany, groupBy };
}

const COMPANY = [
  row({ id: 'ceo', designation: 'CEO', verticalName: 'Executive' }),
  row({
    id: 'cto',
    reportingManagerId: 'ceo',
    photoStorageKey: 'employees/photos/cto',
  }),
  row({ id: 'dev1', reportingManagerId: 'cto' }),
  row({ id: 'dev2', reportingManagerId: 'cto' }),
  // Manager left the company: their report must surface as a root, not vanish.
  row({ id: 'exmgr', status: EmployeeStatus.INACTIVE }),
  row({ id: 'orphan', reportingManagerId: 'exmgr' }),
];

describe('OrgChartService', () => {
  describe('companyChart', () => {
    it('returns only active employees', async () => {
      const { service } = build(COMPANY);
      const chart = await service.companyChart();
      expect(chart.nodes.map((n) => n.id).sort()).toEqual([
        'ceo',
        'cto',
        'dev1',
        'dev2',
        'orphan',
      ]);
    });

    it('roots are the nodes with no manager inside the chart', async () => {
      const { service } = build(COMPANY);
      const chart = await service.companyChart();
      expect(chart.rootIds.sort()).toEqual(['ceo', 'orphan']);
    });

    it('normalises a reporting link to a non-visible manager to null', async () => {
      const { service } = build(COMPANY);
      const chart = await service.companyChart();
      const orphan = chart.nodes.find((n) => n.id === 'orphan');
      expect(orphan?.reportingManagerId).toBeNull();
      // The intact link is preserved.
      expect(chart.nodes.find((n) => n.id === 'cto')?.reportingManagerId).toBe(
        'ceo',
      );
    });

    it('counts active direct reports per node', async () => {
      const { service } = build(COMPANY);
      const chart = await service.companyChart();
      const byId = new Map(chart.nodes.map((n) => [n.id, n]));
      expect(byId.get('ceo')?.directReportCount).toBe(1);
      expect(byId.get('cto')?.directReportCount).toBe(2);
      expect(byId.get('dev1')?.directReportCount).toBe(0);
    });

    it('signs a photo URL only for employees who have a photo', async () => {
      const { service } = build(COMPANY);
      const chart = await service.companyChart();
      const byId = new Map(chart.nodes.map((n) => [n.id, n]));
      expect(byId.get('cto')?.photoUrl).toBe(
        'https://r2.test/employees/photos/cto?sig=x',
      );
      // No photo uploaded — the node falls back to initials in the UI.
      expect(byId.get('ceo')?.photoUrl).toBeNull();
    });

    it('falls back to no photo when storage is unconfigured', async () => {
      const createDownloadUrl = jest.fn();
      const { service } = build(COMPANY, {
        isConfigured: () => false,
        createDownloadUrl,
      } as unknown as Partial<VaultStorageService>);
      const chart = await service.companyChart();
      expect(chart.nodes.every((n) => n.photoUrl === null)).toBe(true);
      expect(createDownloadUrl).not.toHaveBeenCalled();
    });

    it('a signing failure degrades that node to initials instead of failing', async () => {
      const { service } = build(COMPANY, {
        createDownloadUrl: () => Promise.reject(new Error('R2 down')),
      } as unknown as Partial<VaultStorageService>);
      const chart = await service.companyChart();
      expect(chart.nodes.find((n) => n.id === 'cto')?.photoUrl).toBeNull();
    });

    it('exposes only directory-level fields — never a roster-protected column', async () => {
      const { service } = build(COMPANY);
      const chart = await service.companyChart();
      expect(Object.keys(chart.nodes[0]).sort()).toEqual([
        'designation',
        'directReportCount',
        'email',
        'employeeId',
        'firstName',
        'fullName',
        'id',
        'lastName',
        'photoUrl',
        'reportingManagerId',
        'verticalName',
      ]);
    });

    it('builds full names and carries the vertical', async () => {
      const { service } = build(COMPANY);
      const chart = await service.companyChart();
      const ceo = chart.nodes.find((n) => n.id === 'ceo');
      expect(ceo?.fullName).toBe('CEO Person');
      expect(ceo?.designation).toBe('CEO');
      expect(ceo?.verticalName).toBe('Executive');
    });
  });

  describe('neighbourhood', () => {
    it('returns the manager above, the subject, and their direct reports', async () => {
      const { service } = build(COMPANY);
      const view = await service.neighbourhood('cto');
      expect(view.manager?.id).toBe('ceo');
      expect(view.employee.id).toBe('cto');
      expect(view.reports.map((r) => r.id).sort()).toEqual(['dev1', 'dev2']);
    });

    it('reports the manager row as the top of the view (no manager of its own)', async () => {
      const { service } = build(COMPANY);
      const view = await service.neighbourhood('cto');
      expect(view.manager?.reportingManagerId).toBeNull();
      expect(view.employee.reportingManagerId).toBe('ceo');
    });

    it('gives a top-of-company employee no manager row', async () => {
      const { service } = build(COMPANY);
      const view = await service.neighbourhood('ceo');
      expect(view.manager).toBeNull();
      expect(view.employee.reportingManagerId).toBeNull();
      expect(view.reports.map((r) => r.id)).toEqual(['cto']);
    });

    it('treats a deactivated manager as no manager, same as the full chart', async () => {
      const { service } = build(COMPANY);
      const view = await service.neighbourhood('orphan');
      expect(view.manager).toBeNull();
      expect(view.employee.reportingManagerId).toBeNull();
    });

    it('leaves the reports row empty for an individual contributor', async () => {
      const { service } = build(COMPANY);
      const view = await service.neighbourhood('dev1');
      expect(view.reports).toEqual([]);
      expect(view.employee.directReportCount).toBe(0);
    });

    it('carries each report’s own report count so the UI can hint depth', async () => {
      const { service } = build(COMPANY);
      const view = await service.neighbourhood('ceo');
      expect(view.reports[0]?.directReportCount).toBe(2);
    });

    it('still renders for a deactivated employee whose profile is opened', async () => {
      const { service } = build(COMPANY);
      const view = await service.neighbourhood('exmgr');
      expect(view.employee.id).toBe('exmgr');
      expect(view.reports.map((r) => r.id)).toEqual(['orphan']);
    });

    it('throws NotFound for an unknown employee', async () => {
      const { service } = build(COMPANY);
      await expect(service.neighbourhood('nope')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
