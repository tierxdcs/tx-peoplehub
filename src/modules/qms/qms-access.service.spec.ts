import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { QmsAccessService } from './qms-access.service';

describe('QmsAccessService', () => {
  const prisma: any = { employee: { findUnique: jest.fn() } };
  const service = new QmsAccessService(prisma);
  const user: any = { id: 'e1', role: Role.EMPLOYEE };

  beforeEach(() => jest.clearAllMocks());

  it('allows an active Quality-vertical user to execute QMS work without approval', async () => {
    prisma.employee.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      isQcInspector: false,
      isQmsHead: false,
      vertical: { code: 'QUALITY', name: 'Quality' },
    });

    await expect(service.assertUser(user)).resolves.toBeUndefined();
    await expect(service.assertHead(user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('recognizes the Quality vertical by name for existing custom vertical codes', async () => {
    prisma.employee.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      isQcInspector: false,
      isQmsHead: false,
      vertical: { code: 'QA', name: 'Quality' },
    });

    await expect(service.assertUser(user)).resolves.toBeUndefined();
  });

  it('allows an active QC Inspector to execute QMS work without approval', async () => {
    prisma.employee.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      isQcInspector: true,
      isQmsHead: false,
      vertical: null,
    });

    await expect(service.assertUser(user)).resolves.toBeUndefined();
    await expect(service.assertHead(user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows only an explicitly designated QMS Head to approve', async () => {
    prisma.employee.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      isQcInspector: false,
      isQmsHead: true,
      vertical: null,
    });

    await expect(service.assertHead(user)).resolves.toBeUndefined();
  });

  it('gives Super Admin operational access but not implicit QMS approval', async () => {
    prisma.employee.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      isQcInspector: false,
      isQmsHead: false,
      vertical: null,
    });
    const admin = { ...user, role: Role.SUPER_ADMIN };

    await expect(service.assertUser(admin)).resolves.toBeUndefined();
    await expect(service.assertHead(admin)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects a non-Quality user without a QMS capability', async () => {
    prisma.employee.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      isQcInspector: false,
      isQmsHead: false,
      vertical: { code: 'SCM', name: 'SCM' },
    });

    await expect(service.assertUser(user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects an inactive Quality-vertical employee', async () => {
    prisma.employee.findUnique.mockResolvedValue({
      status: 'INACTIVE',
      isQcInspector: true,
      isQmsHead: true,
      vertical: { code: 'QUALITY', name: 'Quality' },
    });

    await expect(service.assertUser(user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
