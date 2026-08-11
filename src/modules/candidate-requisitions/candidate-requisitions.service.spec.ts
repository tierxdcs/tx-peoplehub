import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CandidateRequisitionStatus, Role } from '@prisma/client';
import { CandidateRequisitionsService } from './candidate-requisitions.service';

describe('CandidateRequisitionsService', () => {
  const prisma: any = { candidateRequisition: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() }, employee: { findUnique: jest.fn() }, $transaction: jest.fn() };
  const numbering: any = { nextNumber: jest.fn() };
  const service = new CandidateRequisitionsService(prisma, numbering);
  const manager: any = { id: 'manager', role: Role.MANAGER, verticalId: 'sales' };
  const owner: any = { id: 'owner', role: Role.EMPLOYEE, verticalId: 'sales' };
  const superAdmin: any = { id: 'sa', role: Role.SUPER_ADMIN, verticalId: null };
  const request = { id: 'req', requestedById: 'manager', status: CandidateRequisitionStatus.PENDING_VERTICAL_APPROVAL, vertical: { ownerId: 'owner' }, verticalApprovedAt: null };
  beforeEach(() => { jest.clearAllMocks(); prisma.$transaction.mockImplementation((cb: any) => cb(prisma)); });

  it('derives the manager vertical, persists the CTC budget, and uses shared REQ numbering', async () => {
    numbering.nextNumber.mockResolvedValue('REQ-2026-0001'); prisma.candidateRequisition.create.mockImplementation(({ data }: any) => data);
    const result: any = await service.create({ positionTitle: 'Engineer', employmentType: 'FULL_TIME_PERMANENT' as any, justification: 'Growth', budgetAnnualCtc: 1200000 }, manager);
    expect(result.verticalId).toBe('sales'); expect(result.requisitionNumber).toBe('REQ-2026-0001'); expect(result.budgetAnnualCtc).toBe(1200000);
  });

  it('rejects a requisition without a positive CTC budget', async () => {
    await expect(service.create({ positionTitle: 'Engineer', employmentType: 'FULL_TIME_PERMANENT' as any, justification: 'Growth', budgetAnnualCtc: 0 }, manager)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('keeps first-stage requisitions completely out of the SuperAdmin queue', async () => {
    expect(await service.listVerticalPending(superAdmin)).toEqual([]);
    expect(prisma.candidateRequisition.findMany).not.toHaveBeenCalled();
  });

  it('moves vertical approval to the SuperAdmin stage', async () => {
    prisma.candidateRequisition.findUnique.mockResolvedValue(request); prisma.candidateRequisition.update.mockImplementation(({ data }: any) => data);
    const result: any = await service.approveVertical('req', owner);
    expect(result.status).toBe(CandidateRequisitionStatus.PENDING_SUPERADMIN_APPROVAL);
  });

  it('prevents SuperAdmin from bypassing the vertical-owner stage', async () => {
    await expect(service.approveVertical('req', superAdmin)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires a rejection comment at both stages', async () => {
    prisma.candidateRequisition.findUnique.mockResolvedValue(request);
    await expect(service.rejectVertical('req', ' ', owner)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows final approval only after vertical approval', async () => {
    prisma.candidateRequisition.findUnique.mockResolvedValue({ ...request, status: CandidateRequisitionStatus.PENDING_SUPERADMIN_APPROVAL, verticalApprovedAt: new Date() });
    prisma.candidateRequisition.update.mockImplementation(({ data }: any) => data);
    const result: any = await service.approveSuperAdmin('req', superAdmin);
    expect(result.status).toBe(CandidateRequisitionStatus.APPROVED);
  });
});
