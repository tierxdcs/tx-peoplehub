import { ForbiddenException, BadRequestException } from '@nestjs/common';
import {
  CandidateApplicationStatus,
  CandidateHiringStage,
  OfferLetterStatus,
  Role,
} from '@prisma/client';
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
  let onboardingCompensation: any;
  let service: OfferLettersService;

  const APPLICATION_ID = '22222222-2222-4222-8222-222222222222';
  const REQUISITION_ID = '11111111-1111-4111-8111-111111111111';

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
      candidateApplication: { findUnique: jest.fn(), update: jest.fn() },
      candidateApplicationInvite: { updateMany: jest.fn() },
      candidateRequisition: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn((callback: any) => callback(prisma)),
    };
    payroll = {
      computeCtcBreakdown: jest.fn(),
      composeCtcBreakdown: jest.fn(),
    };
    onboardingCompensation = { calculate: jest.fn() };
    // Best-effort, fire-and-forget: a stub is enough for the approval-flow tests.
    service = new OfferLettersService(
      prisma,
      payroll,
      onboardingCompensation,
      { approvalRequired: jest.fn() } as never,
    );
  });

  // ---- authoring: the offer is addressed to a SELECTED candidate ------------

  /** A SELECTED application on an approved, unconsumed requisition. */
  const selectedApplication = (overrides: any = {}) => ({
    id: APPLICATION_ID,
    name: 'Priya Raman',
    status: CandidateApplicationStatus.SELECTED,
    requisition: {
      id: REQUISITION_ID,
      status: 'APPROVED',
      consumedAt: null,
      onboardedEmployeeId: null,
    },
    ...overrides,
  });

  const offerTerms = {
    offeredDesignation: 'Regional Sales Manager',
    offeredEmploymentType: 'FULL_TIME_PERMANENT' as const,
    offeredDateOfJoining: '2026-10-01',
    offeredWorkLocation: 'Bengaluru',
    offeredTerritory: 'South India',
    offeredMonthlyCtc: 116666,
    keyResponsibilities: 'Build pipeline',
    kpis: 'Revenue',
  };

  it('creates a candidate-anchored letter, claims the requisition and leaves the stage alone', async () => {
    prisma.candidateApplication.findUnique.mockResolvedValue(
      selectedApplication(),
    );
    prisma.offerLetter.findUnique.mockResolvedValue(null);
    prisma.candidateRequisition.updateMany.mockResolvedValue({ count: 1 });
    prisma.offerLetter.create.mockImplementation(({ data }: any) => ({
      id: 'offer-1',
      ...data,
    }));

    const created = await service.save(
      { candidateApplicationId: APPLICATION_ID, ...offerTerms },
      user,
    );

    expect(created.referenceNumber).toMatch(/^PD\/HR\/\d{4}\/RSM-South/);
    const data = prisma.offerLetter.create.mock.calls[0][0].data;
    expect(data.candidateApplicationId).toBe(APPLICATION_ID);
    expect(data.candidateRequisitionId).toBe(REQUISITION_ID);
    // No Employee row is involved at all — that is the whole point.
    expect(data.employeeId).toBeUndefined();
    // The requisition is claimed (one live offer) but NOT advanced: OFFER_EXTENDED
    // means the letter reached the candidate, which is `send`.
    const claim = prisma.candidateRequisition.updateMany.mock.calls[0][0];
    expect(claim.where).toEqual({ id: REQUISITION_ID, consumedAt: null });
    expect(claim.data.consumedAt).toBeInstanceOf(Date);
    expect(claim.data).not.toHaveProperty('hiringStage');
  });

  it('refuses to make an offer to an applicant who was not selected', async () => {
    prisma.candidateApplication.findUnique.mockResolvedValue(
      selectedApplication({
        status: CandidateApplicationStatus.INTERVIEW_SCHEDULED,
      }),
    );
    prisma.offerLetter.findUnique.mockResolvedValue(null);

    await expect(
      service.save({ candidateApplicationId: APPLICATION_ID, ...offerTerms }, user),
    ).rejects.toThrow('marked Selected');
    expect(prisma.offerLetter.create).not.toHaveBeenCalled();
  });

  it('refuses a second live offer on a requisition that already has one', async () => {
    prisma.candidateApplication.findUnique.mockResolvedValue(
      selectedApplication({
        requisition: {
          id: REQUISITION_ID,
          status: 'APPROVED',
          consumedAt: new Date('2026-09-01T00:00:00Z'),
          onboardedEmployeeId: null,
        },
      }),
    );
    prisma.offerLetter.findUnique.mockResolvedValue(null);

    await expect(
      service.save({ candidateApplicationId: APPLICATION_ID, ...offerTerms }, user),
    ).rejects.toThrow('already has a live offer letter');
  });

  it('refuses to create a letter with incomplete offer terms', async () => {
    prisma.candidateApplication.findUnique.mockResolvedValue(
      selectedApplication(),
    );
    prisma.offerLetter.findUnique.mockResolvedValue(null);

    await expect(
      service.save(
        {
          candidateApplicationId: APPLICATION_ID,
          keyResponsibilities: 'Build pipeline',
          kpis: 'Revenue',
        },
        user,
      ),
    ).rejects.toThrow(/offer terms are incomplete/);
  });

  it('will not create a new letter for an employee (an offer precedes the hire)', async () => {
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
    ).rejects.toThrow('New offers are made to a selected candidate');
    expect(prisma.offerLetter.create).not.toHaveBeenCalled();
  });

  it('derives a candidate’s Annexure A from the offered CTC via the onboarding calculator', async () => {
    prisma.offerLetter.findUnique.mockResolvedValue(
      candidateOffer({ status: OfferLetterStatus.DRAFT }),
    );
    onboardingCompensation.calculate.mockResolvedValue({
      basicMonthly: '46666.40',
      hraMonthly: '23333.20',
      conveyanceMonthly: '1600.00',
      otherAllowanceMonthly: '40000.00',
      incentiveAnnual: '60000.00',
    });
    payroll.composeCtcBreakdown.mockResolvedValue({
      grandTotal: { perAnnum: '1400000.00' },
    });

    const doc = await service.getById('offer-1', user);

    expect(doc.compensation.grandTotal.perAnnum).toBe('1400000.00');
    // The candidate has no salary structure, so the employee path must not run.
    expect(payroll.computeCtcBreakdown).not.toHaveBeenCalled();
    const composed = payroll.composeCtcBreakdown.mock.calls[0][0];
    expect(composed.employeeId).toBeNull();
    expect(composed.workLocation).toBe('Bengaluru');
    // Mapped exactly as onboarding persists the first salary structure.
    expect(composed.specialAllowance.toString()).toBe('1600');
    expect(composed.variablePayAnnual.toString()).toBe('60000');
    // The letter greets the candidate by their given name.
    expect(doc.employee.firstName).toBe('Priya');
    expect(doc.employee.lastName).toBe('Raman');
  });

  it('recomputes compensation whenever the printable document is loaded', async () => {
    prisma.offerLetter.findUnique.mockResolvedValue({
      id: 'offer-1',
      employeeId: 'employee-1',
      employee: { firstName: 'Punith' },
    });
    prisma.salaryStructure.findFirst.mockResolvedValue(null);
    payroll.computeCtcBreakdown
      .mockResolvedValueOnce({ grandTotal: { perAnnum: '1400000.00' } })
      .mockResolvedValueOnce({ grandTotal: { perAnnum: '1600000.00' } });

    const first = await service.getForEmployee('employee-1', user);
    const regenerated = await service.getForEmployee('employee-1', user);

    expect(first.compensation.grandTotal.perAnnum).toBe('1400000.00');
    expect(regenerated.compensation.grandTotal.perAnnum).toBe('1600000.00');
    expect(payroll.computeCtcBreakdown).toHaveBeenCalledTimes(2);
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
    candidateApplicationId: null,
    candidateApplication: null,
    candidateRequisition: null,
    candidateRequisitionId: null,
    reportsTo: null,
    createdById: 'hr-1',
    referenceNumber: 'PD/HR/2026/RSM',
    keyResponsibilities: 'Build pipeline',
    kpis: 'Revenue',
    status: OfferLetterStatus.DRAFT,
    snapshotData: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    submittedAt: null,
    approverComments: null,
    sentAt: null,
    acceptedAt: null,
    declinedAt: null,
    declineReason: null,
    offeredDesignation: null,
    offeredEmploymentType: null,
    offeredDateOfJoining: null,
    offeredWorkLocation: null,
    offeredTerritory: null,
    offeredMonthlyCtc: null,
    reportsToId: null,
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

  /** The normal shape from here on: no employee, a selected candidate, and the
   *  offered terms carried by the letter itself. */
  const candidateOffer = (overrides: any = {}) => ({
    ...draftOffer(),
    employeeId: null,
    employee: null,
    candidateApplicationId: APPLICATION_ID,
    candidateApplication: {
      id: APPLICATION_ID,
      name: 'Priya Raman',
      contact: 'priya@example.com',
      status: CandidateApplicationStatus.SELECTED,
    },
    candidateRequisitionId: REQUISITION_ID,
    candidateRequisition: {
      id: REQUISITION_ID,
      requisitionNumber: 'REQ-2026-0007',
      positionTitle: 'Regional Sales Manager',
      hiringStage: CandidateHiringStage.INTERVIEWING,
      vertical: {
        name: 'Sales',
        ownerId: 'owner-1',
        owner: { id: 'owner-1', firstName: 'Vera', lastName: 'Owner' },
      },
    },
    offeredDesignation: 'Regional Sales Manager',
    offeredEmploymentType: 'FULL_TIME_PERMANENT',
    offeredDateOfJoining: new Date('2026-10-01T00:00:00Z'),
    offeredWorkLocation: 'Bengaluru',
    offeredTerritory: 'South India',
    offeredMonthlyCtc: { toString: () => '116666' },
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
    prisma.salaryStructure.findFirst.mockResolvedValue(null);
    payroll.computeCtcBreakdown.mockResolvedValue(compensation);
    prisma.offerLetter.update.mockResolvedValue({});

    await service.submit('offer-1', user);

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
    await expect(service.submit('offer-1', user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('stage 1: the vertical owner approves → PENDING_CEO_APPROVAL, stamping only the vertical stage', async () => {
    prisma.offerLetter.findUnique.mockResolvedValue(
      draftOffer({ status: OfferLetterStatus.PENDING_VERTICAL_APPROVAL }),
    );
    prisma.offerLetter.update.mockResolvedValue({});
    prisma.salaryStructure.findFirst.mockResolvedValue(null);
    payroll.computeCtcBreakdown.mockResolvedValue(compensation);

    await service.approve('offer-1', {}, ownerUser);

    const data = prisma.offerLetter.update.mock.calls[0][0].data;
    expect(data.status).toBe(OfferLetterStatus.PENDING_CEO_APPROVAL);
    expect(data.verticalApprovedById).toBe('owner-1');
    expect(data.verticalApprovedAt).toBeInstanceOf(Date);
    // The CEO stage is NOT stamped by the owner's first sign-off.
    expect(data.ceoApprovedById).toBeUndefined();
  });

  it('routes a candidate-anchored letter by the REQUISITION’s vertical owner', async () => {
    prisma.offerLetter.findUnique.mockResolvedValue(
      candidateOffer({
        status: OfferLetterStatus.PENDING_VERTICAL_APPROVAL,
        snapshotData: { compensation },
      }),
    );
    prisma.offerLetter.update.mockResolvedValue({});

    await service.approve('offer-1', {}, ownerUser);

    expect(prisma.offerLetter.update.mock.calls[0][0].data.status).toBe(
      OfferLetterStatus.PENDING_CEO_APPROVAL,
    );
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
    prisma.salaryStructure.findFirst.mockResolvedValue(null);
    payroll.computeCtcBreakdown.mockResolvedValue(compensation);

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

  // ---- the candidate's own answer ------------------------------------------

  it('send stamps the letter and moves the requisition to OFFER_EXTENDED', async () => {
    prisma.offerLetter.findUnique.mockResolvedValue(
      candidateOffer({
        status: OfferLetterStatus.APPROVED,
        snapshotData: { compensation },
      }),
    );
    prisma.offerLetter.update.mockResolvedValue({});
    prisma.candidateRequisition.updateMany.mockResolvedValue({ count: 1 });

    await service.send('offer-1', user);

    const data = prisma.offerLetter.update.mock.calls[0][0].data;
    expect(data.sentAt).toBeInstanceOf(Date);
    // A re-send after a decline is a fresh attempt.
    expect(data.declinedAt).toBeNull();
    const staged = prisma.candidateRequisition.updateMany.mock.calls[0][0];
    expect(staged.data.hiringStage).toBe(CandidateHiringStage.OFFER_EXTENDED);
  });

  it('send refuses a letter that is not fully approved', async () => {
    prisma.offerLetter.findUnique.mockResolvedValue(
      candidateOffer({ status: OfferLetterStatus.PENDING_CEO_APPROVAL }),
    );
    await expect(service.send('offer-1', user)).rejects.toThrow(
      'fully approved',
    );
    expect(prisma.offerLetter.update).not.toHaveBeenCalled();
  });

  it('accept stamps the acceptance and closes the application links', async () => {
    prisma.offerLetter.findUnique.mockResolvedValue(
      candidateOffer({
        status: OfferLetterStatus.APPROVED,
        sentAt: new Date('2026-09-02T00:00:00Z'),
        snapshotData: { compensation },
      }),
    );
    prisma.offerLetter.update.mockResolvedValue({});
    prisma.candidateApplicationInvite.updateMany.mockResolvedValue({ count: 2 });

    await service.accept('offer-1', user);

    expect(
      prisma.offerLetter.update.mock.calls[0][0].data.acceptedAt,
    ).toBeInstanceOf(Date);
    expect(
      prisma.candidateApplicationInvite.updateMany.mock.calls[0][0].where,
    ).toEqual({ requisitionId: REQUISITION_ID, revokedAt: null });
    // The requisition is NOT fulfilled by acceptance — onboarding does that.
    expect(prisma.candidateRequisition.update).not.toHaveBeenCalled();
  });

  it('accept refuses an offer that was never sent to the candidate', async () => {
    prisma.offerLetter.findUnique.mockResolvedValue(
      candidateOffer({ status: OfferLetterStatus.APPROVED, sentAt: null }),
    );
    await expect(service.accept('offer-1', user)).rejects.toThrow(
      'Record the offer as sent',
    );
  });

  it('decline releases the requisition and records OFFER_DECLINED on the application', async () => {
    prisma.offerLetter.findUnique.mockResolvedValue(
      candidateOffer({
        status: OfferLetterStatus.APPROVED,
        sentAt: new Date('2026-09-02T00:00:00Z'),
        hiringStage: CandidateHiringStage.OFFER_EXTENDED,
        snapshotData: { compensation },
      }),
    );
    prisma.offerLetter.update.mockResolvedValue({});
    prisma.candidateApplication.update.mockResolvedValue({});
    prisma.candidateRequisition.update.mockResolvedValue({});

    await service.decline(
      'offer-1',
      { declineReason: 'Took a counter-offer' },
      user,
    );

    const data = prisma.offerLetter.update.mock.calls[0][0].data;
    expect(data.declinedAt).toBeInstanceOf(Date);
    expect(data.declineReason).toBe('Took a counter-offer');
    // Their refusal, not our rejection.
    expect(prisma.candidateApplication.update.mock.calls[0][0].data).toEqual({
      status: CandidateApplicationStatus.OFFER_DECLINED,
    });
    // The requisition reopens for the next applicant without re-approval.
    expect(prisma.candidateRequisition.update.mock.calls[0][0].data).toEqual({
      consumedAt: null,
      selectedCandidateName: null,
      hiringStage: CandidateHiringStage.INTERVIEWING,
    });
  });

  it('decline requires a reason', async () => {
    prisma.offerLetter.findUnique.mockResolvedValue(
      candidateOffer({
        status: OfferLetterStatus.APPROVED,
        sentAt: new Date('2026-09-02T00:00:00Z'),
      }),
    );
    await expect(
      service.decline('offer-1', { declineReason: '  ' }, user),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.offerLetter.update).not.toHaveBeenCalled();
  });

  it('decline refuses an offer the candidate already accepted', async () => {
    prisma.offerLetter.findUnique.mockResolvedValue(
      candidateOffer({
        status: OfferLetterStatus.APPROVED,
        sentAt: new Date('2026-09-02T00:00:00Z'),
        acceptedAt: new Date('2026-09-03T00:00:00Z'),
      }),
    );
    await expect(
      service.decline('offer-1', { declineReason: 'Changed mind' }, user),
    ).rejects.toThrow('already been accepted');
  });

  // ---- edit invalidation ---------------------------------------------------

  it('editing an APPROVED offer letter invalidates the approval back to DRAFT', async () => {
    prisma.offerLetter.findUnique.mockResolvedValue({
      id: 'offer-1',
      employeeId: 'employee-1',
      status: OfferLetterStatus.APPROVED,
      acceptedAt: null,
      sentAt: null,
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
    prisma.offerLetter.findUnique.mockResolvedValue({
      id: 'offer-1',
      employeeId: 'employee-1',
      status: OfferLetterStatus.DRAFT,
      acceptedAt: null,
      sentAt: null,
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

  it('editing a SENT offer un-sends it and rolls the requisition back off OFFER_EXTENDED', async () => {
    prisma.offerLetter.findUnique.mockResolvedValue({
      id: 'offer-1',
      employeeId: null,
      candidateApplicationId: APPLICATION_ID,
      candidateRequisitionId: REQUISITION_ID,
      status: OfferLetterStatus.APPROVED,
      sentAt: new Date('2026-09-02T00:00:00Z'),
      acceptedAt: null,
    });
    prisma.offerLetter.update.mockResolvedValue({});
    prisma.candidateRequisition.updateMany.mockResolvedValue({ count: 1 });

    await service.save(
      {
        candidateApplicationId: APPLICATION_ID,
        keyResponsibilities: 'Reworded',
        kpis: 'Revenue',
      },
      user,
    );

    const data = prisma.offerLetter.update.mock.calls[0][0].data;
    expect(data.status).toBe(OfferLetterStatus.DRAFT);
    expect(data.sentAt).toBeNull();
    expect(
      prisma.candidateRequisition.updateMany.mock.calls[0][0].data.hiringStage,
    ).toBe(CandidateHiringStage.INTERVIEWING);
  });

  it('an ACCEPTED offer letter can no longer be edited at all', async () => {
    prisma.offerLetter.findUnique.mockResolvedValue({
      id: 'offer-1',
      employeeId: null,
      candidateApplicationId: APPLICATION_ID,
      status: OfferLetterStatus.APPROVED,
      sentAt: new Date('2026-09-02T00:00:00Z'),
      acceptedAt: new Date('2026-09-03T00:00:00Z'),
    });

    await expect(
      service.save(
        {
          candidateApplicationId: APPLICATION_ID,
          keyResponsibilities: 'Reworded',
          kpis: 'Revenue',
        },
        user,
      ),
    ).rejects.toThrow('accepted by the candidate');
    expect(prisma.offerLetter.update).not.toHaveBeenCalled();
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

    // The self-exclusion lives INSIDE the employee filter: `employeeId: { not }`
    // on a nullable column would silently drop every candidate-anchored letter.
    expect(prisma.offerLetter.findMany.mock.calls[0][0].where).toEqual({
      status: OfferLetterStatus.PENDING_VERTICAL_APPROVAL,
      createdById: { not: 'owner-1' },
      OR: [
        {
          employee: {
            is: { id: { not: 'owner-1' }, vertical: { ownerId: 'owner-1' } },
          },
        },
        {
          employee: null,
          candidateRequisition: { vertical: { ownerId: 'owner-1' } },
        },
      ],
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
    // A candidate-anchored letter routes by its requisition's vertical instead.
    const candidateOwned = pendingRow({
      id: 'candidate-owned',
      employeeId: null,
      employee: null,
      candidateRequisition: { vertical: { ownerId: 'someone' } },
    });
    const realOwnerStage = pendingRow({ id: 'owned' }); // ownerId 'someone'
    prisma.offerLetter.findMany.mockResolvedValue([
      ceoStage,
      ownerlessFallback,
      candidateOwned,
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
    expect(prisma.offerLetter.count.mock.calls[0][0].where.createdById).toEqual({
      not: 'owner-1',
    });
  });
});
