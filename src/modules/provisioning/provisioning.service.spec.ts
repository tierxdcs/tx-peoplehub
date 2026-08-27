import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  ProvisioningApproverType,
  ProvisioningRequestStatus,
  Role,
} from '@prisma/client';
import { ProvisioningService } from './provisioning.service';

describe('ProvisioningService', () => {
  const prisma: any = {
    provisioningItemType: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    provisioningRequest: {
      createMany: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    vertical: { findUnique: jest.fn() },
    employee: { findUnique: jest.fn() },
  };
  const service = new ProvisioningService(prisma);
  const superAdmin: any = {
    id: 'sa',
    role: Role.SUPER_ADMIN,
    verticalId: null,
  };
  const owner: any = { id: 'owner', role: Role.EMPLOYEE, verticalId: 'hr' };
  const baseRequest = {
    id: 'r1',
    employeeId: 'hire',
    status: ProvisioningRequestStatus.PENDING_APPROVAL,
    itemType: {
      requiresScmFulfillment: true,
      approverType: ProvisioningApproverType.VERTICAL_OWNER,
      approverVertical: { ownerId: 'owner' },
    },
  };

  beforeEach(() => jest.clearAllMocks());

  it('creates one idempotent request per active item type', async () => {
    prisma.provisioningItemType.findMany.mockResolvedValue([
      { id: 'a' },
      { id: 'b' },
    ]);
    prisma.provisioningRequest.createMany.mockResolvedValue({ count: 2 });
    await service.createForEmployee('hire');
    expect(prisma.provisioningRequest.createMany).toHaveBeenCalledWith({
      data: [
        { employeeId: 'hire', itemTypeId: 'a' },
        { employeeId: 'hire', itemTypeId: 'b' },
      ],
      skipDuplicates: true,
    });
  });

  it('sends an approved physical item to SCM', async () => {
    prisma.provisioningRequest.findUnique.mockResolvedValue(baseRequest);
    prisma.provisioningRequest.update.mockImplementation(
      ({ data }: any) => data,
    );
    const result: any = await service.approve('r1', owner);
    expect(result.status).toBe(ProvisioningRequestStatus.SENT_TO_SCM);
    expect(result.approvedById).toBe('owner');
  });

  it('completes a digital item directly on approval', async () => {
    prisma.provisioningRequest.findUnique.mockResolvedValue({
      ...baseRequest,
      itemType: { ...baseRequest.itemType, requiresScmFulfillment: false },
    });
    prisma.provisioningRequest.update.mockImplementation(
      ({ data }: any) => data,
    );
    const result: any = await service.approve('r1', owner);
    expect(result.status).toBe(ProvisioningRequestStatus.COMPLETED);
    expect(result.completedById).toBe('owner');
  });

  it('requires a rejection comment', async () => {
    prisma.provisioningRequest.findUnique.mockResolvedValue(baseRequest);
    await expect(service.reject('r1', '  ', owner)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('blocks an employee from approving their own request even as SuperAdmin', async () => {
    prisma.provisioningRequest.findUnique.mockResolvedValue({
      ...baseRequest,
      employeeId: 'sa',
    });
    await expect(service.approve('r1', superAdmin)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
