import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { RfqAccessService } from './rfq-access.service';

describe('RfqAccessService.assertCanApprove', () => {
  const prisma: any = { employee: { findUnique: jest.fn() } };
  const service = new RfqAccessService(prisma);

  const pm: any = { id: 'pm', role: Role.MANAGER };
  const nonPm: any = { id: 'emp', role: Role.MANAGER };
  const superAdmin: any = { id: 'sa', role: Role.SUPER_ADMIN };

  beforeEach(() => jest.clearAllMocks());

  it('lets a Project Manager approve an RFQ they created themselves', async () => {
    prisma.employee.findUnique.mockResolvedValue({ isProjectManager: true });
    // The PM is the creator here — self-approval is now allowed.
    await expect(service.assertCanApprove(pm)).resolves.toBeUndefined();
  });

  it('lets a SUPER_ADMIN approve without a PM lookup', async () => {
    await expect(service.assertCanApprove(superAdmin)).resolves.toBeUndefined();
    expect(prisma.employee.findUnique).not.toHaveBeenCalled();
  });

  it('blocks a non-Project-Manager from approving', async () => {
    prisma.employee.findUnique.mockResolvedValue({ isProjectManager: false });
    await expect(service.assertCanApprove(nonPm)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
