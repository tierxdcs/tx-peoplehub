import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  CandidateHiringStage,
  CandidateRequisitionStatus,
  Role,
} from '@prisma/client';
import { CandidateRequisitionsService } from './candidate-requisitions.service';

describe('CandidateRequisitionsService', () => {
  const prisma: any = {
    candidateRequisition: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    employee: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const numbering: any = { nextNumber: jest.fn() };
  const service = new CandidateRequisitionsService(prisma, numbering);
  const manager: any = {
    id: 'manager',
    role: Role.MANAGER,
    verticalId: 'sales',
  };
  const owner: any = { id: 'owner', role: Role.EMPLOYEE, verticalId: 'sales' };
  const superAdmin: any = {
    id: 'sa',
    role: Role.SUPER_ADMIN,
    verticalId: null,
  };
  const request = {
    id: 'req',
    requestedById: 'manager',
    status: CandidateRequisitionStatus.PENDING_VERTICAL_APPROVAL,
    vertical: { ownerId: 'owner' },
    verticalApprovedAt: null,
  };
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((cb: any) => cb(prisma));
  });

  it('derives the manager vertical, persists the CTC budget, and uses shared REQ numbering', async () => {
    numbering.nextNumber.mockResolvedValue('REQ-2026-0001');
    prisma.candidateRequisition.create.mockImplementation(
      ({ data }: any) => data,
    );
    const [result]: any = await service.create(
      {
        positionTitle: 'Engineer',
        employmentType: 'FULL_TIME_PERMANENT' as any,
        justification: 'Growth',
        keyResponsibilities: 'Own delivery',
        keyPerformanceIndicators: 'On-time delivery %',
        budgetAnnualCtc: 1200000,
      },
      manager,
    );
    expect(result.verticalId).toBe('sales');
    expect(result.requisitionNumber).toBe('REQ-2026-0001');
    expect(result.budgetAnnualCtc).toBe(1200000);
    expect(result.keyResponsibilities).toBe('Own delivery');
    expect(result.keyPerformanceIndicators).toBe('On-time delivery %');
  });

  it('bulk-raises N identical requisitions with consecutive REQ numbers in one transaction', async () => {
    let seq = 0;
    numbering.nextNumber.mockImplementation(() =>
      Promise.resolve(`REQ-2026-000${++seq}`),
    );
    prisma.candidateRequisition.create.mockImplementation(
      ({ data }: any) => data,
    );
    const results: any = await service.create(
      {
        positionTitle: 'Engineer',
        employmentType: 'FULL_TIME_PERMANENT' as any,
        justification: 'Growth',
        keyResponsibilities: 'Own delivery',
        keyPerformanceIndicators: 'On-time delivery %',
        budgetAnnualCtc: 1200000,
        numberOfPositions: 3,
      },
      manager,
    );
    expect(results).toHaveLength(3);
    expect(results.map((r: any) => r.requisitionNumber)).toEqual([
      'REQ-2026-0001',
      'REQ-2026-0002',
      'REQ-2026-0003',
    ]);
    // Every position is its own row with the same JD/budget.
    expect(results.every((r: any) => r.positionTitle === 'Engineer')).toBe(
      true,
    );
    expect(prisma.candidateRequisition.create).toHaveBeenCalledTimes(3);
    // One transaction wraps the whole batch — all or nothing.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects a requisition without a positive CTC budget', async () => {
    await expect(
      service.create(
        {
          positionTitle: 'Engineer',
          employmentType: 'FULL_TIME_PERMANENT' as any,
          justification: 'Growth',
          keyResponsibilities: 'Own delivery',
          keyPerformanceIndicators: 'On-time delivery %',
          budgetAnnualCtc: 0,
        },
        manager,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a requisition missing key responsibilities or KPIs', async () => {
    await expect(
      service.create(
        {
          positionTitle: 'Engineer',
          employmentType: 'FULL_TIME_PERMANENT' as any,
          justification: 'Growth',
          keyResponsibilities: '  ',
          keyPerformanceIndicators: 'On-time delivery %',
          budgetAnnualCtc: 1200000,
        },
        manager,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('keeps first-stage requisitions completely out of the SuperAdmin queue', async () => {
    expect(await service.listVerticalPending(superAdmin)).toEqual([]);
    expect(prisma.candidateRequisition.findMany).not.toHaveBeenCalled();
  });

  it('moves vertical approval to the SuperAdmin stage', async () => {
    prisma.candidateRequisition.findUnique.mockResolvedValue(request);
    prisma.candidateRequisition.update.mockImplementation(
      ({ data }: any) => data,
    );
    const result: any = await service.approveVertical('req', owner);
    expect(result.status).toBe(
      CandidateRequisitionStatus.PENDING_SUPERADMIN_APPROVAL,
    );
  });

  it('prevents SuperAdmin from bypassing the vertical-owner stage', async () => {
    await expect(
      service.approveVertical('req', superAdmin),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires a rejection comment at both stages', async () => {
    prisma.candidateRequisition.findUnique.mockResolvedValue(request);
    await expect(
      service.rejectVertical('req', ' ', owner),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows final approval only after vertical approval', async () => {
    prisma.candidateRequisition.findUnique.mockResolvedValue({
      ...request,
      status: CandidateRequisitionStatus.PENDING_SUPERADMIN_APPROVAL,
      verticalApprovedAt: new Date(),
    });
    prisma.candidateRequisition.update.mockImplementation(
      ({ data }: any) => data,
    );
    const result: any = await service.approveSuperAdmin('req', superAdmin);
    expect(result.status).toBe(CandidateRequisitionStatus.APPROVED);
  });

  it('blocks the CEO from finalising an owned vertical before the owner approves', async () => {
    prisma.candidateRequisition.findUnique.mockResolvedValue(request); // owned vertical, still PENDING_VERTICAL_APPROVAL
    await expect(
      service.approveSuperAdmin('req', superAdmin),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.candidateRequisition.update).not.toHaveBeenCalled();
  });

  it('routes an ownerless vertical straight to the CEO, who finalises it in one approval', async () => {
    prisma.candidateRequisition.findUnique.mockResolvedValue({
      ...request,
      vertical: { ownerId: null },
      verticalApprovedAt: null,
    });
    prisma.candidateRequisition.update.mockImplementation(
      ({ data }: any) => data,
    );
    const result: any = await service.approveSuperAdmin('req', superAdmin);
    expect(result.status).toBe(CandidateRequisitionStatus.APPROVED);
    expect(result.verticalApprovedById).toBe('sa');
    expect(result.superAdminApprovedById).toBe('sa');
  });

  it('lets the CEO finalise a requisition whose vertical owner is the requester (self-approval deadlock)', async () => {
    prisma.candidateRequisition.findUnique.mockResolvedValue({
      ...request,
      requestedById: 'owner',
      vertical: { ownerId: 'owner' }, // owner raised it themselves — cannot self-approve
      verticalApprovedAt: null,
    });
    prisma.candidateRequisition.update.mockImplementation(
      ({ data }: any) => data,
    );
    const result: any = await service.approveSuperAdmin('req', superAdmin);
    expect(result.status).toBe(CandidateRequisitionStatus.APPROVED);
    expect(result.verticalApprovedById).toBe('sa');
    expect(result.superAdminApprovedById).toBe('sa');
  });

  it('surfaces vertical-stage requisitions the CEO must clear in the SuperAdmin queue', async () => {
    prisma.candidateRequisition.findMany.mockResolvedValue([
      // awaiting the final approval — always in the queue
      {
        ...request,
        id: 'r1',
        status: CandidateRequisitionStatus.PENDING_SUPERADMIN_APPROVAL,
        verticalApprovedAt: new Date(),
      },
      // ownerless vertical — no first-stage approver
      { ...request, id: 'r2', vertical: { ownerId: null } },
      // owner is the requester — self-approval deadlock
      {
        ...request,
        id: 'r3',
        requestedById: 'owner',
        vertical: { ownerId: 'owner' },
      },
      // owned by someone other than the requester — the owner must approve first
      {
        ...request,
        id: 'r4',
        requestedById: 'manager',
        vertical: { ownerId: 'owner' },
      },
    ]);

    const result: any[] = await service.listSuperAdminPending(superAdmin);

    expect(result.map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
  });

  it('lets the CEO reject an ownerless-vertical requisition directly', async () => {
    prisma.candidateRequisition.findUnique.mockResolvedValue({
      ...request,
      vertical: { ownerId: null },
      verticalApprovedAt: null,
    });
    prisma.candidateRequisition.update.mockImplementation(
      ({ data }: any) => data,
    );
    const result: any = await service.rejectSuperAdmin(
      'req',
      'Not needed',
      superAdmin,
    );
    expect(result.status).toBe(CandidateRequisitionStatus.REJECTED);
  });

  it('lets the requester cancel their own pending requisition', async () => {
    prisma.candidateRequisition.findUnique.mockResolvedValue({
      ...request,
      requestedById: 'manager',
    });
    prisma.candidateRequisition.update.mockImplementation(
      ({ data }: any) => data,
    );
    const result: any = await service.cancel('req', manager);
    expect(result.status).toBe(CandidateRequisitionStatus.CANCELLED);
  });

  it('prevents anyone but the requester from cancelling', async () => {
    prisma.candidateRequisition.findUnique.mockResolvedValue({
      ...request,
      requestedById: 'someone-else',
    });
    await expect(service.cancel('req', manager)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.candidateRequisition.update).not.toHaveBeenCalled();
  });

  it('refuses to cancel a requisition that is no longer pending', async () => {
    prisma.candidateRequisition.findUnique.mockResolvedValue({
      ...request,
      requestedById: 'manager',
      status: CandidateRequisitionStatus.APPROVED,
    });
    await expect(service.cancel('req', manager)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.candidateRequisition.update).not.toHaveBeenCalled();
  });

  it('allows an HR employee to update an approved requisition hiring stage', async () => {
    prisma.employee.findUnique.mockResolvedValue({ vertical: { code: 'HR' } });
    prisma.candidateRequisition.findUnique.mockResolvedValue({
      ...request,
      status: CandidateRequisitionStatus.APPROVED,
      hiringStage: null,
    });
    prisma.candidateRequisition.update.mockImplementation(
      ({ data }: any) => data,
    );

    const result: any = await service.updateHiringLifecycle(
      'req',
      { hiringStage: CandidateHiringStage.JOB_POSTED },
      { id: 'hr-user', role: Role.EMPLOYEE, verticalId: 'hr' } as any,
    );

    expect(result.hiringStage).toBe(CandidateHiringStage.JOB_POSTED);
  });

  it('prevents a non-HR employee from editing hiring progress', async () => {
    prisma.employee.findUnique.mockResolvedValue({
      vertical: { code: 'SALES' },
    });

    await expect(
      service.updateHiringLifecycle(
        'req',
        { hiringStage: CandidateHiringStage.JOB_POSTED },
        owner,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.candidateRequisition.findUnique).not.toHaveBeenCalled();
  });

  it('does not permit hiring progress before both approvals are complete', async () => {
    prisma.employee.findUnique.mockResolvedValue({ vertical: { code: 'HR' } });
    prisma.candidateRequisition.findUnique.mockResolvedValue({
      ...request,
      hiringStage: null,
    });

    await expect(
      service.updateHiringLifecycle(
        'req',
        { hiringStage: CandidateHiringStage.JOB_POSTED },
        { id: 'hr-user', role: Role.EMPLOYEE, verticalId: 'hr' } as any,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('uses the selected candidate name as the terminal fulfilment signal', async () => {
    prisma.employee.findUnique.mockResolvedValue({ vertical: { code: 'HR' } });
    prisma.candidateRequisition.findUnique.mockResolvedValue({
      ...request,
      status: CandidateRequisitionStatus.APPROVED,
      hiringStage: CandidateHiringStage.INTERVIEWING,
    });
    prisma.candidateRequisition.update.mockImplementation(
      ({ data }: any) => data,
    );

    const result: any = await service.updateHiringLifecycle(
      'req',
      {
        hiringStage: CandidateHiringStage.INTERVIEWING,
        selectedCandidateName: '  Priya Rao  ',
      },
      { id: 'hr-user', role: Role.EMPLOYEE, verticalId: 'hr' } as any,
    );

    expect(result).toEqual(
      expect.objectContaining({
        hiringStage: CandidateHiringStage.CANDIDATE_SELECTED,
        selectedCandidateName: 'Priya Rao',
      }),
    );
  });

  it('requires a candidate name and keeps fulfilled requisitions terminal', async () => {
    prisma.employee.findUnique.mockResolvedValue({ vertical: { code: 'HR' } });
    prisma.candidateRequisition.findUnique
      .mockResolvedValueOnce({
        ...request,
        status: CandidateRequisitionStatus.APPROVED,
        hiringStage: CandidateHiringStage.OFFER_EXTENDED,
      })
      .mockResolvedValueOnce({
        ...request,
        status: CandidateRequisitionStatus.APPROVED,
        hiringStage: CandidateHiringStage.CANDIDATE_SELECTED,
      });
    const hrUser = {
      id: 'hr-user',
      role: Role.EMPLOYEE,
      verticalId: 'hr',
    } as any;

    await expect(
      service.updateHiringLifecycle(
        'req',
        { hiringStage: CandidateHiringStage.CANDIDATE_SELECTED },
        hrUser,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateHiringLifecycle(
        'req',
        {
          hiringStage: CandidateHiringStage.CANDIDATE_SELECTED,
          selectedCandidateName: 'Another Person',
        },
        hrUser,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('gives the CEO unrestricted visibility of every requisition, including first-stage owned-vertical requests', async () => {
    prisma.employee.findUnique.mockResolvedValue({ vertical: null });
    prisma.candidateRequisition.findMany.mockResolvedValue([]);

    await service.listRegister(superAdmin);

    expect(prisma.candidateRequisition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('scopes the lifecycle register to a requester or their vertical owner', async () => {
    prisma.employee.findUnique.mockResolvedValue({
      vertical: { code: 'SALES' },
    });
    prisma.candidateRequisition.findMany.mockResolvedValue([]);

    await service.listRegister(owner);

    expect(prisma.candidateRequisition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ requestedById: 'owner' }, { vertical: { ownerId: 'owner' } }],
        },
      }),
    );
  });

  it('returns approved requisition responsibilities and KPIs for Offer Letter prefill', async () => {
    prisma.employee.findUnique.mockResolvedValue({
      verticalId: 'sales',
      designation: 'Sample Manager',
    });
    prisma.candidateRequisition.findMany.mockResolvedValue([
      {
        id: 'req-offer',
        requisitionNumber: 'REQ-2026-0001',
        positionTitle: 'Sample Manager',
        keyResponsibilities: 'Lead the regional sales team',
        keyPerformanceIndicators: 'Revenue attainment\nGross margin',
      },
    ]);

    const result = await service.availableForEmployee('employee-1', manager);

    expect(prisma.candidateRequisition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: CandidateRequisitionStatus.APPROVED,
          consumedAt: null,
          offerLetter: null,
          verticalId: 'sales',
          positionTitle: {
            equals: 'Sample Manager',
            mode: 'insensitive',
          },
        }),
      }),
    );
    expect(result[0]).toEqual(
      expect.objectContaining({
        keyResponsibilities: 'Lead the regional sales team',
        keyPerformanceIndicators: 'Revenue attainment\nGross margin',
      }),
    );
  });

  it('offers unlinked Approved and Fulfilled requisitions and enriches them from an Approved Offer Letter', async () => {
    prisma.employee.findUnique.mockResolvedValue({ vertical: { code: 'HR' } });
    prisma.candidateRequisition.findMany.mockResolvedValue([
      {
        id: 'req',
        requisitionNumber: 'REQ-2026-0001',
        positionTitle: 'Engineer',
        employmentType: 'FULL_TIME_PERMANENT',
        selectedCandidateName: 'Priya Rao',
        vertical: { id: 'rnd', name: 'R&D' },
        offerLetter: {
          id: 'offer',
          referenceNumber: 'PD/HR/2026/ENG',
          status: 'APPROVED',
          snapshotData: {
            employee: {
              firstName: 'Priya',
              lastName: 'Rao',
              designation: 'Engineer',
              employmentType: 'FULL_TIME_PERMANENT',
            },
            compensation: {
              effectiveFrom: '2026-09-01T00:00:00.000Z',
              directComponents: [
                { label: 'Basic Salary', perMonth: '50000.00' },
                { label: 'House Rent Allowance (HRA)', perMonth: '20000.00' },
                { label: 'Special Allowance', perMonth: '5000.00' },
              ],
              indirectBenefits: [
                { label: 'Variable Pay', perAnnum: '60000.00' },
              ],
            },
          },
        },
      },
    ]);

    const result: any[] = await service.listOnboardingOptions({
      id: 'hr-user',
      role: Role.EMPLOYEE,
      verticalId: 'hr',
    } as any);

    expect(prisma.candidateRequisition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: CandidateRequisitionStatus.APPROVED,
          hiringStage: CandidateHiringStage.CANDIDATE_SELECTED,
          onboardedEmployeeId: null,
        },
      }),
    );
    expect(result[0]).toEqual(
      expect.objectContaining({
        selectedCandidateName: 'Priya Rao',
        designation: 'Engineer',
        compensation: expect.objectContaining({
          basicSalary: '50000.00',
          variablePay: '60000.00',
        }),
      }),
    );
  });

  it('keeps a fulfilled requisition selectable without an Offer Letter and prefills its role facts (compensation stays offer-gated)', async () => {
    prisma.employee.findUnique.mockResolvedValue({ vertical: { code: 'HR' } });
    prisma.candidateRequisition.findMany.mockResolvedValue([
      {
        id: 'req-no-offer',
        requisitionNumber: 'REQ-2026-0003',
        positionTitle: 'Technician',
        employmentType: 'CONTRACT',
        selectedCandidateName: 'Arun Kumar',
        vertical: { id: 'production', name: 'Production' },
        offerLetter: null,
      },
    ]);

    const [result]: any[] = await service.listOnboardingOptions({
      id: 'hr-user',
      role: Role.EMPLOYEE,
      verticalId: 'hr',
    } as any);

    expect(result).toEqual(
      expect.objectContaining({
        selectedCandidateName: 'Arun Kumar',
        hasApprovedOffer: false,
        // Role facts prefill from the requisition even without an Offer Letter.
        designation: 'Technician',
        employmentType: 'CONTRACT',
        vertical: { id: 'production', name: 'Production' },
        // Compensation stays gated on an approved Offer Letter.
        compensation: null,
      }),
    );
  });

  it('keeps a fulfilled requisition selectable when its Offer Letter is not approved and ignores those draft terms', async () => {
    prisma.employee.findUnique.mockResolvedValue({ vertical: { code: 'HR' } });
    prisma.candidateRequisition.findMany.mockResolvedValue([
      {
        id: 'req-draft-offer',
        requisitionNumber: 'REQ-2026-0001',
        positionTitle: 'Manager',
        employmentType: 'FULL_TIME_PERMANENT',
        selectedCandidateName: 'Meera Shah',
        vertical: { id: 'sales', name: 'Sales' },
        offerLetter: {
          id: 'draft-offer',
          referenceNumber: 'DRAFT/001',
          status: 'DRAFT',
          snapshotData: {
            employee: { designation: 'Unapproved designation' },
            compensation: {
              directComponents: [
                { label: 'Basic Salary', perMonth: '999999.00' },
              ],
            },
          },
        },
      },
    ]);

    const [result]: any[] = await service.listOnboardingOptions({
      id: 'hr-user',
      role: Role.EMPLOYEE,
      verticalId: 'hr',
    } as any);

    expect(result).toEqual(
      expect.objectContaining({
        selectedCandidateName: 'Meera Shah',
        offerLetterId: null,
        offerReferenceNumber: null,
        hasApprovedOffer: false,
        // Draft offer terms are ignored; role facts come from the requisition
        // (designation is the positionTitle, not the draft's snapshot value).
        designation: 'Manager',
        employmentType: 'FULL_TIME_PERMANENT',
        vertical: { id: 'sales', name: 'Sales' },
        compensation: null,
      }),
    );
  });
});
