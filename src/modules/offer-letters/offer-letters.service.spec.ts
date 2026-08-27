import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { CandidateHiringStage, OfferLetterStatus, Role } from '@prisma/client';
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
      salaryStructure: { findFirst: jest.fn() },
      offerLetter: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
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
      hiringStage: null,
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
      expect.objectContaining({
        where: { id: '11111111-1111-4111-8111-111111111111' },
        data: expect.objectContaining({
          consumedAt: expect.any(Date),
          hiringStage: CandidateHiringStage.OFFER_EXTENDED,
        }),
      }),
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
      id: 'employee-1',
      designation: 'Engineer',
      territory: null,
      verticalId: 'rnd',
    });
    prisma.offerLetter.findUnique.mockResolvedValue(null);
    await expect(
      service.save(
        {
          employeeId: 'employee-1',
          keyResponsibilities: 'Build',
          kpis: 'Quality',
        },
        user,
      ),
    ).rejects.toThrow(
      'An approved, unconsumed candidate requisition is required',
    );
    expect(prisma.offerLetter.create).not.toHaveBeenCalled();
  });

  // ---- two-stage approval gate --------------------------------------------

  const ownerUser = {
    id: 'owner-1',
    email: 'o@x.com',
    role: Role.MANAGER,
    verticalId: 'v1',
  };

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
    approverComments: null,
    verticalApprovedById: null,
    verticalApprovedBy: null,
    verticalApprovedAt: null,
    ceoApprovedById: null,
    ceoApprovedBy: null,
    ceoApprovedAt: null,
    rejectedById: null,
    rejectedBy: null,
    rejectedAt: null,
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
        ownerId: 'owner-1',
        owner: { id: 'owner-1', firstName: 'Vera', lastName: 'Owner' },
      },
      reportingManager: null,
    },
    ...overrides,
  });

  /** Build an owner-less (or self-owned) vertical for CEO-fallback scenarios. */
  const withVertical = (
    overrides: any,
    vertical: { ownerId: string | null; owner: any },
  ) =>
    draftOffer({
      ...overrides,
      employee: {
        ...draftOffer().employee,
        vertical: { name: 'Sales', ...vertical },
      },
    });

  const compensation = { grandTotal: { perAnnum: '1400000.00' } };

  it('submit freezes a snapshot, clears prior stamps and moves to PENDING_VERTICAL_APPROVAL', async () => {
    prisma.offerLetter.findUnique.mockResolvedValue(draftOffer());
    payroll.computeCtcBreakdown.mockResolvedValue(compensation);
    prisma.offerLetter.update.mockResolvedValue({});

    await service.submit('employee-1', user);

    const data = prisma.offerLetter.update.mock.calls[0][0].data;
    expect(data.status).toBe(OfferLetterStatus.PENDING_VERTICAL_APPROVAL);
    // Routing is derived live at decision time — submit stamps no approver, and
    // clears any decision stamps from a prior cycle.
    expect(data.verticalApprovedById).toBeNull();
    expect(data.ceoApprovedById).toBeNull();
    expect(data.rejectedById).toBeNull();
    expect(data.submittedAt).toBeInstanceOf(Date);
    // Snapshot is a curated, JSON-safe payload — not the raw employee row.
    expect(data.snapshotData.employee.firstName).toBe('Punith');
    expect(data.snapshotData.compensation.grandTotal.perAnnum).toBe(
      '1400000.00',
    );
    expect(typeof data.snapshotData.employee.dateOfJoining).toBe('string');
  });

  it('submit rejects an offer letter that is not DRAFT/REJECTED', async () => {
    prisma.offerLetter.findUnique.mockResolvedValue(
      draftOffer({ status: OfferLetterStatus.PENDING_VERTICAL_APPROVAL }),
    );
    await expect(service.submit('employee-1', user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('stage 1: the vertical owner approves → PENDING_CEO_APPROVAL, stamping only the vertical stage', async () => {
    prisma.offerLetter.findUnique.mockResolvedValue(
      draftOffer({ status: OfferLetterStatus.PENDING_VERTICAL_APPROVAL }),
    );
    prisma.offerLetter.update.mockResolvedValue({});

    await service.approve('offer-1', {}, ownerUser);

    const data = prisma.offerLetter.update.mock.calls[0][0].data;
    expect(data.status).toBe(OfferLetterStatus.PENDING_CEO_APPROVAL);
    expect(data.verticalApprovedById).toBe('owner-1');
    expect(data.verticalApprovedAt).toBeInstanceOf(Date);
    // The CEO stage is NOT stamped by the owner's first sign-off.
    expect(data.ceoApprovedById).toBeUndefined();
  });

  it('stage 1: the CEO cannot pre-empt the vertical owner while an owner exists', async () => {
    prisma.offerLetter.findUnique.mockResolvedValue(
      draftOffer({ status: OfferLetterStatus.PENDING_VERTICAL_APPROVAL }),
    );
    await expect(service.approve('offer-1', {}, user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.offerLetter.update).not.toHaveBeenCalled();
  });

  it('stage 2: the CEO gives the final approval → APPROVED, stamping only the CEO stage', async () => {
    prisma.offerLetter.findUnique.mockResolvedValue(
      draftOffer({
        status: OfferLetterStatus.PENDING_CEO_APPROVAL,
        verticalApprovedById: 'owner-1',
        verticalApprovedAt: new Date('2026-01-02T00:00:00Z'),
        snapshotData: { compensation },
      }),
    );
    prisma.offerLetter.update.mockResolvedValue({});

    await service.approve('offer-1', {}, user);

    const data = prisma.offerLetter.update.mock.calls[0][0].data;
    expect(data.status).toBe(OfferLetterStatus.APPROVED);
    expect(data.ceoApprovedById).toBe('admin-1');
    expect(data.ceoApprovedAt).toBeInstanceOf(Date);
    // The already-recorded vertical stage is left untouched.
    expect(data.verticalApprovedById).toBeUndefined();
  });

  it('stage 2: a vertical owner cannot give the final (CEO) approval', async () => {
    prisma.offerLetter.findUnique.mockResolvedValue(
      draftOffer({
        status: OfferLetterStatus.PENDING_CEO_APPROVAL,
        verticalApprovedById: 'owner-1',
      }),
    );
    await expect(
      service.approve('offer-1', {}, ownerUser),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.offerLetter.update).not.toHaveBeenCalled();
  });

  it('fallback: the CEO finalises an owner-less letter directly, stamping BOTH stages', async () => {
    prisma.offerLetter.findUnique.mockResolvedValue(
      withVertical(
        {
          status: OfferLetterStatus.PENDING_VERTICAL_APPROVAL,
          createdById: 'admin-1', // even one the CEO submitted (no deadlock)
          snapshotData: { compensation },
        },
        { ownerId: null, owner: null },
      ),
    );
    prisma.offerLetter.update.mockResolvedValue({});

    await service.approve('offer-1', {}, user);

    const data = prisma.offerLetter.update.mock.calls[0][0].data;
    expect(data.status).toBe(OfferLetterStatus.APPROVED);
    expect(data.verticalApprovedById).toBe('admin-1');
    expect(data.ceoApprovedById).toBe('admin-1');
  });

  it('fallback: when the owner is the subject, the CEO finalises from the vertical stage', async () => {
    prisma.offerLetter.findUnique.mockResolvedValue(
      withVertical(
        {
          status: OfferLetterStatus.PENDING_VERTICAL_APPROVAL,
          employeeId: 'owner-1', // the new hire IS the vertical owner
          snapshotData: { compensation },
        },
        { ownerId: 'owner-1', owner: { id: 'owner-1' } },
      ),
    );
    prisma.offerLetter.update.mockResolvedValue({});

    await service.approve('offer-1', {}, user);

    const data = prisma.offerLetter.update.mock.calls[0][0].data;
    expect(data.status).toBe(OfferLetterStatus.APPROVED);
    expect(data.verticalApprovedById).toBe('admin-1');
    expect(data.ceoApprovedById).toBe('admin-1');
  });

  it('blocks the submitter (who is also the owner) from approving at the vertical stage', async () => {
    // Owner == submitter → self-approval; this is a CEO-fallback case, so a
    // non-CEO owner-submitter must be refused (the CEO will finalise instead).
    prisma.offerLetter.findUnique.mockResolvedValue(
      draftOffer({
        status: OfferLetterStatus.PENDING_VERTICAL_APPROVAL,
        createdById: 'owner-1',
      }),
    );
    await expect(
      service.approve('offer-1', {}, ownerUser),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.offerLetter.update).not.toHaveBeenCalled();
  });

  it('blocks self-approval even for a CEO who is the subject', async () => {
    prisma.offerLetter.findUnique.mockResolvedValue(
      draftOffer({
        status: OfferLetterStatus.PENDING_CEO_APPROVAL,
        employeeId: 'admin-1', // the letter is FOR the CEO
      }),
    );
    await expect(service.approve('offer-1', {}, user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('blocks a manager who is neither the routed owner nor the CEO', async () => {
    const stranger = {
      id: 'mgr-9',
      email: 'm@x.com',
      role: Role.MANAGER,
      verticalId: 'v9',
    };
    prisma.offerLetter.findUnique.mockResolvedValue(
      draftOffer({ status: OfferLetterStatus.PENDING_VERTICAL_APPROVAL }),
    );
    await expect(
      service.approve('offer-1', {}, stranger),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('approve rejects a letter that is not awaiting a decision', async () => {
    prisma.offerLetter.findUnique.mockResolvedValue(
      draftOffer({ status: OfferLetterStatus.DRAFT }),
    );
    await expect(service.approve('offer-1', {}, user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('reject requires a comment', async () => {
    prisma.offerLetter.findUnique.mockResolvedValue(
      draftOffer({ status: OfferLetterStatus.PENDING_VERTICAL_APPROVAL }),
    );

    await expect(
      service.reject('offer-1', { approverComments: '   ' }, ownerUser),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.offerLetter.update).not.toHaveBeenCalled();
  });

  it('reject at the vertical stage by the owner → REJECTED, stamping the rejecter and discarding the snapshot', async () => {
    prisma.offerLetter.findUnique.mockResolvedValue(
      draftOffer({
        status: OfferLetterStatus.PENDING_VERTICAL_APPROVAL,
        snapshotData: { compensation },
      }),
    );
    prisma.offerLetter.update.mockResolvedValue({});

    await service.reject(
      'offer-1',
      { approverComments: 'Fix the CTC' },
      ownerUser,
    );

    const data = prisma.offerLetter.update.mock.calls[0][0].data;
    expect(data.status).toBe(OfferLetterStatus.REJECTED);
    expect(data.rejectedById).toBe('owner-1');
    expect(data.rejectedAt).toBeInstanceOf(Date);
    expect(data.approverComments).toBe('Fix the CTC');
    expect(data.snapshotData).toBeDefined(); // Prisma.DbNull sentinel, not undefined
  });

  it('reject at the CEO stage is restricted to the CEO', async () => {
    prisma.offerLetter.findUnique.mockResolvedValue(
      draftOffer({
        status: OfferLetterStatus.PENDING_CEO_APPROVAL,
        verticalApprovedById: 'owner-1',
      }),
    );
    await expect(
      service.reject('offer-1', { approverComments: 'No' }, ownerUser),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.offerLetter.update).not.toHaveBeenCalled();
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
    expect(data.verticalApprovedById).toBeNull();
    expect(data.ceoApprovedById).toBeNull();
    expect(data.rejectedById).toBeNull();
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
    expect(data).not.toHaveProperty('verticalApprovedById');
  });

  it('serves the frozen snapshot (not live data) once APPROVED', async () => {
    prisma.offerLetter.findUnique.mockResolvedValue({
      id: 'offer-1',
      employeeId: 'employee-1',
      status: OfferLetterStatus.APPROVED,
      submittedAt: new Date('2026-01-02T00:00:00Z'),
      approverComments: null,
      verticalApprovedBy: { firstName: 'Vera', lastName: 'Owner' },
      verticalApprovedAt: new Date('2026-01-03T00:00:00Z'),
      ceoApprovedBy: { firstName: 'Cee', lastName: 'Oh' },
      ceoApprovedAt: new Date('2026-01-04T00:00:00Z'),
      rejectedBy: null,
      rejectedAt: null,
      snapshotData: {
        referenceNumber: 'PD/HR/2026/RSM',
        compensation: { grandTotal: { perAnnum: '999999.00' } },
      },
      employee: {
        vertical: {
          ownerId: 'owner-1',
          owner: { firstName: 'Vera', lastName: 'Owner' },
        },
      },
    });

    const doc = await service.getForEmployee('employee-1', user);

    expect(doc.compensation.grandTotal.perAnnum).toBe('999999.00');
    expect(doc.status).toBe(OfferLetterStatus.APPROVED);
    expect(doc.verticalApprovedBy?.firstName).toBe('Vera');
    expect(doc.ceoApprovedBy?.firstName).toBe('Cee');
    // The frozen path must NOT recompute compensation.
    expect(payroll.computeCtcBreakdown).not.toHaveBeenCalled();
  });

  it('scopes the pending-approval list to the routed owner for a non-CEO caller', async () => {
    prisma.offerLetter.findMany.mockResolvedValue([]);

    await service.listPendingApproval(ownerUser);

    expect(prisma.offerLetter.findMany.mock.calls[0][0].where).toEqual({
      status: OfferLetterStatus.PENDING_VERTICAL_APPROVAL,
      createdById: { not: 'owner-1' },
      employeeId: { not: 'owner-1' },
      employee: { vertical: { ownerId: 'owner-1' } },
    });
  });

  it("the CEO's queue is every CEO-stage letter plus only the vertical-stage fallbacks", async () => {
    const pendingRow = (over: any) => ({
      id: 'x',
      status: OfferLetterStatus.PENDING_VERTICAL_APPROVAL,
      employeeId: 'e',
      createdById: 'c',
      employee: { vertical: { ownerId: 'someone' } },
      ...over,
    });
    const ceoStage = pendingRow({
      id: 'ceo',
      status: OfferLetterStatus.PENDING_CEO_APPROVAL,
    });
    const ownerlessFallback = pendingRow({
      id: 'fallback',
      employee: { vertical: { ownerId: null } },
    });
    const realOwnerStage = pendingRow({ id: 'owned' }); // ownerId 'someone'
    prisma.offerLetter.findMany.mockResolvedValue([
      ceoStage,
      ownerlessFallback,
      realOwnerStage,
    ]);

    const list = await service.listPendingApproval(user);

    expect(list.map((l: any) => l.id)).toEqual(['ceo', 'fallback']);
    expect(
      prisma.offerLetter.findMany.mock.calls[0][0].where.status.in,
    ).toEqual([
      OfferLetterStatus.PENDING_CEO_APPROVAL,
      OfferLetterStatus.PENDING_VERTICAL_APPROVAL,
    ]);
  });

  it('summarises the CEO queue from the filtered list (no column-to-column DB count)', async () => {
    const oldest = new Date('2026-01-02T00:00:00.000Z');
    prisma.offerLetter.findMany.mockResolvedValue([
      {
        id: 'ceo',
        status: OfferLetterStatus.PENDING_CEO_APPROVAL,
        submittedAt: oldest,
        employeeId: 'e',
        createdById: 'c',
        employee: { vertical: { ownerId: 'x' } },
      },
      {
        id: 'fallback',
        status: OfferLetterStatus.PENDING_VERTICAL_APPROVAL,
        submittedAt: new Date('2026-01-05T00:00:00.000Z'),
        employeeId: 'e',
        createdById: 'c',
        employee: { vertical: { ownerId: null } },
      },
      {
        id: 'owned',
        status: OfferLetterStatus.PENDING_VERTICAL_APPROVAL,
        submittedAt: new Date('2026-01-06T00:00:00.000Z'),
        employeeId: 'e',
        createdById: 'c',
        employee: { vertical: { ownerId: 'x' } },
      },
    ]);

    // The list is already submittedAt-ascending, so the badge's "oldest
    // waiting" stamp is the first surviving row's submittedAt.
    expect(await service.pendingApprovalQueue(user)).toEqual({
      count: 2,
      oldestPendingAt: oldest,
    });
    expect(prisma.offerLetter.count).not.toHaveBeenCalled();
  });

  it('summarises a non-CEO owner queue with a direct DB count', async () => {
    const oldest = new Date('2026-02-03T00:00:00.000Z');
    prisma.offerLetter.count.mockResolvedValue(4);
    prisma.offerLetter.findFirst.mockResolvedValue({ submittedAt: oldest });

    expect(await service.pendingApprovalQueue(ownerUser)).toEqual({
      count: 4,
      oldestPendingAt: oldest,
    });
    expect(prisma.offerLetter.count.mock.calls[0][0].where).toEqual({
      status: OfferLetterStatus.PENDING_VERTICAL_APPROVAL,
      createdById: { not: 'owner-1' },
      employeeId: { not: 'owner-1' },
      employee: { vertical: { ownerId: 'owner-1' } },
    });
  });
});
