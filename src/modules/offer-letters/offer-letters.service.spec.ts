import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { OfferLetterStatus, Role } from '@prisma/client';
import { OfferLettersService } from './offer-letters.service';

describe('OfferLettersService', () => {
  const user = {
    id: 'admin-1',
    email: 'admin@phaze-dynamics.com',
    role: Role.SUPER_ADMIN,
    verticalId: null,
  };
  let prisma: any;
  let payroll: any;
  let service: OfferLettersService;

  beforeEach(() => {
    prisma = {
      employee: { findUnique: jest.fn() },
      offerLetter: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      candidateRequisition: { findUnique: jest.fn(), update: jest.fn() },
      $transaction: jest.fn(),
    };
    payroll = { computeCtcBreakdown: jest.fn() };
    service = new OfferLettersService(prisma, payroll);
  });

  it('generates the reference once and preserves it when authored content changes', async () => {
    prisma.employee.findUnique.mockResolvedValue({
      id: 'employee-1',
      designation: 'Regional Sales Manager',
      territory: 'South India',
      verticalId: 'sales-v',
    });
    prisma.$transaction.mockImplementation((callback: any) => callback(prisma));
    prisma.candidateRequisition.findUnique.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      status: 'APPROVED',
      consumedAt: null,
      offerLetter: null,
      verticalId: 'sales-v',
      positionTitle: 'Regional Sales Manager',
    });
    prisma.candidateRequisition.update.mockResolvedValue({});
    prisma.offerLetter.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prisma.offerLetter.create.mockImplementation(({ data }: any) => ({
      id: 'offer-1',
      ...data,
    }));

    const created = await service.save(
      {
        employeeId: 'employee-1',
        candidateRequisitionId: '11111111-1111-4111-8111-111111111111',
        keyResponsibilities: 'Build pipeline',
        kpis: 'Revenue',
      },
      user,
    );
    expect(created.referenceNumber).toMatch(/^PD\/HR\/\d{4}\/RSM-South/);
    expect(prisma.offerLetter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          candidateRequisitionId: '11111111-1111-4111-8111-111111111111',
        }),
      }),
    );
    expect(prisma.candidateRequisition.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: '11111111-1111-4111-8111-111111111111' } }),
    );

    prisma.offerLetter.findUnique.mockReset();
    prisma.offerLetter.findUnique.mockResolvedValue({
      id: 'offer-1',
      referenceNumber: created.referenceNumber,
    });
    prisma.offerLetter.update.mockResolvedValue({
      id: 'offer-1',
      referenceNumber: created.referenceNumber,
      keyResponsibilities: 'Updated responsibility',
      kpis: 'Revenue',
    });
    const updated = await service.save(
      {
        employeeId: 'employee-1',
        keyResponsibilities: 'Updated responsibility',
        kpis: 'Revenue',
      },
      user,
    );

    expect(updated.referenceNumber).toBe(created.referenceNumber);
    expect(prisma.offerLetter.create).toHaveBeenCalledTimes(1);
    expect(prisma.offerLetter.update).toHaveBeenCalledTimes(1);
  });

  it('recomputes compensation whenever the printable document is loaded', async () => {
    prisma.offerLetter.findUnique.mockResolvedValue({
      id: 'offer-1',
      employeeId: 'employee-1',
      employee: { firstName: 'Punith' },
    });
    payroll.computeCtcBreakdown
      .mockResolvedValueOnce({ grandTotal: { perAnnum: '1400000.00' } })
      .mockResolvedValueOnce({ grandTotal: { perAnnum: '1600000.00' } });

    const first = await service.getForEmployee('employee-1', user);
    const regenerated = await service.getForEmployee('employee-1', user);

    expect(first.compensation.grandTotal.perAnnum).toBe('1400000.00');
    expect(regenerated.compensation.grandTotal.perAnnum).toBe('1600000.00');
    expect(payroll.computeCtcBreakdown).toHaveBeenCalledTimes(2);
  });

  it('blocks a new offer letter when no approved requisition is selected', async () => {
    prisma.employee.findUnique.mockResolvedValue({
      id: 'employee-1', designation: 'Engineer', territory: null, verticalId: 'rnd',
    });
    prisma.offerLetter.findUnique.mockResolvedValue(null);
    await expect(service.save({ employeeId: 'employee-1', keyResponsibilities: 'Build', kpis: 'Quality' }, user)).rejects.toThrow(
      'An approved, unconsumed candidate requisition is required',
    );
    expect(prisma.offerLetter.create).not.toHaveBeenCalled();
  });

  // ---- approval gate ------------------------------------------------------

  const draftOffer = (overrides: any = {}) => ({
    id: 'offer-1',
    employeeId: 'employee-1',
    createdById: 'hr-1',
    referenceNumber: 'PD/HR/2026/RSM',
    keyResponsibilities: 'Build pipeline',
    kpis: 'Revenue',
    status: OfferLetterStatus.DRAFT,
    snapshotData: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    submittedAt: null,
    decidedAt: null,
    approverComments: null,
    approverId: null,
    approver: null,
    employee: {
      firstName: 'Punith',
      lastName: 'K',
      gender: 'Male',
      designation: 'Regional Sales Manager',
      employmentType: 'FULL_TIME_PERMANENT',
      dateOfJoining: new Date('2026-02-01T00:00:00Z'),
      workLocation: 'Bengaluru',
      territory: 'South India',
      vertical: {
        name: 'Sales',
        owner: { id: 'owner-1', firstName: 'Vera', lastName: 'Owner' },
      },
      reportingManager: null,
    },
    ...overrides,
  });

  const compensation = { grandTotal: { perAnnum: '1400000.00' } };

  it('submit freezes a snapshot, routes to the vertical owner and moves to PENDING_APPROVAL', async () => {
    prisma.offerLetter.findUnique.mockResolvedValue(draftOffer());
    payroll.computeCtcBreakdown.mockResolvedValue(compensation);
    prisma.offerLetter.update.mockResolvedValue({});

    await service.submit('employee-1', user);

    const data = prisma.offerLetter.update.mock.calls[0][0].data;
    expect(data.status).toBe(OfferLetterStatus.PENDING_APPROVAL);
    expect(data.approverId).toBe('owner-1');
    expect(data.submittedAt).toBeInstanceOf(Date);
    // Snapshot is a curated, JSON-safe payload — not the raw employee row.
    expect(data.snapshotData.employee.firstName).toBe('Punith');
    expect(data.snapshotData.compensation.grandTotal.perAnnum).toBe(
      '1400000.00',
    );
    expect(typeof data.snapshotData.employee.dateOfJoining).toBe('string');
  });

  it('submit falls back to SuperAdmin-only (null approver) when the vertical has no owner', async () => {
    prisma.offerLetter.findUnique.mockResolvedValue(
      draftOffer({
        employee: { ...draftOffer().employee, vertical: { name: 'Sales', owner: null } },
      }),
    );
    payroll.computeCtcBreakdown.mockResolvedValue(compensation);
    prisma.offerLetter.update.mockResolvedValue({});

    await service.submit('employee-1', user);

    expect(prisma.offerLetter.update.mock.calls[0][0].data.approverId).toBeNull();
  });

  it('submit falls back to SuperAdmin when the owner would be the submitter (self-approval)', async () => {
    prisma.offerLetter.findUnique.mockResolvedValue(
      draftOffer({
        createdById: 'owner-1', // submitter IS the vertical owner
      }),
    );
    payroll.computeCtcBreakdown.mockResolvedValue(compensation);
    prisma.offerLetter.update.mockResolvedValue({});

    await service.submit('employee-1', user);

    expect(prisma.offerLetter.update.mock.calls[0][0].data.approverId).toBeNull();
  });

  it('submit rejects an offer letter that is not DRAFT/REJECTED', async () => {
    prisma.offerLetter.findUnique.mockResolvedValue(
      draftOffer({ status: OfferLetterStatus.PENDING_APPROVAL }),
    );
    await expect(service.submit('employee-1', user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('approve moves PENDING_APPROVAL to APPROVED and stamps the approver', async () => {
    const owner = { id: 'owner-1', email: 'o@x.com', role: Role.MANAGER, verticalId: 'v1' };
    prisma.offerLetter.findUnique.mockResolvedValue(
      draftOffer({ status: OfferLetterStatus.PENDING_APPROVAL, approverId: 'owner-1' }),
    );
    payroll.computeCtcBreakdown.mockResolvedValue(compensation);
    prisma.offerLetter.update.mockResolvedValue({});

    await service.approve('offer-1', {}, owner);

    const data = prisma.offerLetter.update.mock.calls[0][0].data;
    expect(data.status).toBe(OfferLetterStatus.APPROVED);
    expect(data.approverId).toBe('owner-1');
    expect(data.decidedAt).toBeInstanceOf(Date);
  });

  it('reject requires a comment', async () => {
    const owner = { id: 'owner-1', email: 'o@x.com', role: Role.MANAGER, verticalId: 'v1' };
    prisma.offerLetter.findUnique.mockResolvedValue(
      draftOffer({ status: OfferLetterStatus.PENDING_APPROVAL, approverId: 'owner-1' }),
    );

    await expect(
      service.reject('offer-1', { approverComments: '   ' }, owner),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.offerLetter.update).not.toHaveBeenCalled();
  });

  it('reject with a comment moves to REJECTED and discards the snapshot', async () => {
    const owner = { id: 'owner-1', email: 'o@x.com', role: Role.MANAGER, verticalId: 'v1' };
    prisma.offerLetter.findUnique.mockResolvedValue(
      draftOffer({ status: OfferLetterStatus.PENDING_APPROVAL, approverId: 'owner-1' }),
    );
    prisma.offerLetter.update.mockResolvedValue({});

    await service.reject('offer-1', { approverComments: 'Fix the CTC' }, owner);

    const data = prisma.offerLetter.update.mock.calls[0][0].data;
    expect(data.status).toBe(OfferLetterStatus.REJECTED);
    expect(data.approverComments).toBe('Fix the CTC');
    expect(data.snapshotData).toBeDefined(); // Prisma.DbNull sentinel, not undefined
  });

  it('blocks self-approval even for a SuperAdmin who is the subject', async () => {
    prisma.offerLetter.findUnique.mockResolvedValue(
      draftOffer({
        status: OfferLetterStatus.PENDING_APPROVAL,
        employeeId: 'admin-1', // the letter is FOR the SuperAdmin
      }),
    );
    await expect(service.approve('offer-1', {}, user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('blocks the submitter from approving their own submission', async () => {
    const submitter = { id: 'hr-1', email: 'hr@x.com', role: Role.MANAGER, verticalId: 'v1' };
    prisma.offerLetter.findUnique.mockResolvedValue(
      draftOffer({ status: OfferLetterStatus.PENDING_APPROVAL, createdById: 'hr-1' }),
    );
    await expect(
      service.approve('offer-1', {}, submitter),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets a SuperAdmin approve an owner-less letter they submitted (no deadlock)', async () => {
    // Owner-less vertical → approverId null → SuperAdmin-only fallback. If the
    // sole SuperAdmin also submitted it, the submitter block must NOT fire —
    // otherwise nobody can ever approve the letter.
    prisma.offerLetter.findUnique.mockResolvedValue(
      draftOffer({
        status: OfferLetterStatus.PENDING_APPROVAL,
        createdById: 'admin-1', // the SuperAdmin submitted it
        approverId: null,
        snapshotData: { compensation },
      }),
    );
    prisma.offerLetter.update.mockResolvedValue({});
    await service.approve('offer-1', {}, user);
    const data = prisma.offerLetter.update.mock.calls[0][0].data;
    expect(data.status).toBe(OfferLetterStatus.APPROVED);
    expect(data.approverId).toBe('admin-1');
  });

  it('blocks a manager who is neither the routed owner nor a SuperAdmin', async () => {
    const stranger = { id: 'mgr-9', email: 'm@x.com', role: Role.MANAGER, verticalId: 'v9' };
    prisma.offerLetter.findUnique.mockResolvedValue(
      draftOffer({ status: OfferLetterStatus.PENDING_APPROVAL, approverId: 'owner-1' }),
    );
    await expect(
      service.approve('offer-1', {}, stranger),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('editing an APPROVED offer letter invalidates the approval back to DRAFT', async () => {
    prisma.employee.findUnique.mockResolvedValue({ id: 'employee-1' });
    prisma.offerLetter.findUnique.mockResolvedValue({
      id: 'offer-1',
      status: OfferLetterStatus.APPROVED,
    });
    prisma.offerLetter.update.mockResolvedValue({});

    await service.save(
      { employeeId: 'employee-1', keyResponsibilities: 'New', kpis: 'New' },
      user,
    );

    const data = prisma.offerLetter.update.mock.calls[0][0].data;
    expect(data.status).toBe(OfferLetterStatus.DRAFT);
    expect(data.approverId).toBeNull();
    expect(data.submittedAt).toBeNull();
    expect(data.snapshotData).toBeDefined(); // Prisma.DbNull sentinel
  });

  it('editing a still-DRAFT offer letter does NOT reset status fields', async () => {
    prisma.employee.findUnique.mockResolvedValue({ id: 'employee-1' });
    prisma.offerLetter.findUnique.mockResolvedValue({
      id: 'offer-1',
      status: OfferLetterStatus.DRAFT,
    });
    prisma.offerLetter.update.mockResolvedValue({});

    await service.save(
      { employeeId: 'employee-1', keyResponsibilities: 'New', kpis: 'New' },
      user,
    );

    const data = prisma.offerLetter.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('status');
    expect(data).not.toHaveProperty('approverId');
  });

  it('serves the frozen snapshot (not live data) once APPROVED', async () => {
    prisma.offerLetter.findUnique.mockResolvedValue({
      id: 'offer-1',
      employeeId: 'employee-1',
      status: OfferLetterStatus.APPROVED,
      submittedAt: new Date('2026-01-02T00:00:00Z'),
      decidedAt: new Date('2026-01-03T00:00:00Z'),
      approverComments: null,
      approver: { firstName: 'Vera', lastName: 'Owner' },
      snapshotData: {
        referenceNumber: 'PD/HR/2026/RSM',
        compensation: { grandTotal: { perAnnum: '999999.00' } },
      },
      employee: { vertical: { owner: { firstName: 'Vera', lastName: 'Owner' } } },
    });

    const doc = await service.getForEmployee('employee-1', user);

    expect(doc.compensation.grandTotal.perAnnum).toBe('999999.00');
    expect(doc.status).toBe(OfferLetterStatus.APPROVED);
    // The frozen path must NOT recompute compensation.
    expect(payroll.computeCtcBreakdown).not.toHaveBeenCalled();
  });

  it('scopes the pending-approval list to the owner for a non-SuperAdmin caller', async () => {
    const owner = { id: 'owner-1', email: 'o@x.com', role: Role.MANAGER, verticalId: 'v1' };
    prisma.offerLetter.findMany.mockResolvedValue([]);

    await service.listPendingApproval(owner);

    expect(prisma.offerLetter.findMany.mock.calls[0][0].where).toEqual({
      status: OfferLetterStatus.PENDING_APPROVAL,
      approverId: 'owner-1',
    });
  });

  it('scopes the pending-approval list to every pending letter for a SuperAdmin', async () => {
    prisma.offerLetter.count.mockResolvedValue(3);

    await service.countPendingApproval(user);

    expect(prisma.offerLetter.count.mock.calls[0][0].where).toEqual({
      status: OfferLetterStatus.PENDING_APPROVAL,
    });
  });
});
