import {
  CandidateApplicationStatus,
  CandidateHiringStage,
  CandidateRequisitionStatus,
  Role,
} from '@prisma/client';
import { CandidateApplicationsService } from './candidate-applications.service';

describe('CandidateApplicationsService', () => {
  const prisma: any = {
    employee: { findUnique: jest.fn() },
    candidateRequisition: { findUnique: jest.fn(), update: jest.fn() },
    candidateApplicationInvite: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    candidateApplication: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    offerLetter: { count: jest.fn(), findFirst: jest.fn() },
    financeCompanySettings: { findFirst: jest.fn() },
    $transaction: jest.fn((callback: any) => callback(prisma)),
  };
  const storage: any = {
    createUploadUrl: jest.fn(),
    headObject: jest.fn(),
    createDownloadUrl: jest.fn(),
  };
  const email: any = { send: jest.fn() };
  const config: any = {
    get: jest.fn((key: string) =>
      key === 'frontendOrigin' ? 'https://app.example.com' : undefined,
    ),
  };
  const service = new CandidateApplicationsService(
    prisma,
    storage,
    email,
    config,
  );
  const hr = {
    id: 'hr-1',
    email: 'hr@phaze-dynamics.com',
    role: Role.EMPLOYEE,
    verticalId: 'hr-v',
  };
  const requisition = {
    id: 'req-1',
    requestedById: 'manager-1',
    status: CandidateRequisitionStatus.APPROVED,
    hiringStage: CandidateHiringStage.INTERVIEWING,
    // Filtered to accepted offers only by the queries that include it — an empty
    // list is the open-position case.
    offerLetters: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.employee.findUnique.mockResolvedValue({ vertical: { code: 'HR' } });
    prisma.candidateRequisition.findUnique.mockResolvedValue(requisition);
    prisma.offerLetter.count.mockResolvedValue(0);
    prisma.offerLetter.findFirst.mockResolvedValue(null);
    prisma.financeCompanySettings.findFirst.mockResolvedValue({
      legalName: 'Phaze Dynamics',
    });
  });

  it('creates a reusable, password-optional link for an Approved requisition', async () => {
    prisma.candidateApplicationInvite.create.mockImplementation(
      ({ data }: any) =>
        Promise.resolve({
          id: 'invite-1',
          ...data,
          revokedAt: null,
          createdAt: new Date(),
        }),
    );

    const result = await service.createInvite('req-1', {}, hr);

    expect(result.token).toBeTruthy();
    expect(result.hasPassword).toBe(false);
    expect(prisma.candidateApplicationInvite.create).toHaveBeenCalledTimes(1);
  });

  it('does not consume the invite when a candidate submits', async () => {
    prisma.candidateApplicationInvite.findUnique.mockResolvedValue({
      id: 'invite-1',
      requisitionId: 'req-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      passwordHash: null,
      requisition: {
        ...requisition,
        requisitionNumber: 'REQ-2026-0001',
        positionTitle: 'Engineer',
        employmentType: 'FULL_TIME_PERMANENT',
        vertical: { name: 'Engineering' },
      },
    });
    storage.headObject.mockResolvedValue({
      sizeBytes: 100,
      contentType: 'application/pdf',
    });
    prisma.candidateApplication.create.mockResolvedValue({
      id: 'app-1',
      status: CandidateApplicationStatus.SUBMITTED,
      submittedAt: new Date(),
    });
    const dto = {
      name: 'Candidate One',
      contact: 'one@example.com',
      areaOfExpertise: 'Fabrication',
      totalExperienceYears: 5,
      relevantExperienceYears: 3,
      aboutExperience: 'Manufacturing experience',
      resumeFileKey: 'candidate-applications/resumes/abc',
      resumeFileName: 'resume.pdf',
      resumeFileSize: 100,
      resumeMimeType: 'application/pdf',
    };

    await service.submit('reusable-token', dto);
    await service.submit('reusable-token', { ...dto, name: 'Candidate Two' });

    expect(prisma.candidateApplication.create).toHaveBeenCalledTimes(2);
    expect(prisma.candidateApplicationInvite.update).not.toHaveBeenCalled();
  });

  it('selecting an application records the name but neither fulfils the requisition nor closes its links', async () => {
    prisma.candidateApplication.findUnique.mockResolvedValue({
      id: 'app-1',
      requisitionId: 'req-1',
      name: 'Selected Person',
      status: CandidateApplicationStatus.INTERVIEW_SCHEDULED,
      offerLetter: null,
      requisition,
    });
    prisma.candidateRequisition.update.mockResolvedValue({});
    prisma.candidateApplication.update.mockResolvedValue({
      id: 'app-1',
      status: CandidateApplicationStatus.SELECTED,
    });

    await service.updateStatus(
      'app-1',
      CandidateApplicationStatus.SELECTED,
      hr,
    );

    // Selection authorizes an offer — it is not the hire, so the stage stays put.
    expect(prisma.candidateRequisition.update).toHaveBeenCalledWith({
      where: { id: 'req-1' },
      data: { selectedCandidateName: 'Selected Person' },
    });
    // The links stay open: the candidate may still decline, and re-opening the
    // position from scratch would be the wrong recovery.
    expect(prisma.candidateApplicationInvite.updateMany).not.toHaveBeenCalled();
  });

  it('refuses to select a second applicant while an offer is out to somebody else', async () => {
    prisma.candidateApplication.findUnique.mockResolvedValue({
      id: 'app-2',
      requisitionId: 'req-1',
      name: 'Runner Up',
      status: CandidateApplicationStatus.INTERVIEW_SCHEDULED,
      offerLetter: null,
      requisition,
    });
    prisma.offerLetter.findFirst.mockResolvedValue({
      candidateApplication: { name: 'Selected Person' },
    });

    await expect(
      service.updateStatus('app-2', CandidateApplicationStatus.SELECTED, hr),
    ).rejects.toThrow('already out to Selected Person');
    expect(prisma.candidateApplication.update).not.toHaveBeenCalled();
  });

  it('refuses to overwrite the status of an applicant who holds a live offer', async () => {
    prisma.candidateApplication.findUnique.mockResolvedValue({
      id: 'app-1',
      requisitionId: 'req-1',
      name: 'Selected Person',
      status: CandidateApplicationStatus.SELECTED,
      offerLetter: { id: 'offer-1', status: 'APPROVED', declinedAt: null },
      requisition,
    });

    await expect(
      service.updateStatus('app-1', CandidateApplicationStatus.REJECTED, hr),
    ).rejects.toThrow('live offer letter');
    expect(prisma.candidateApplication.update).not.toHaveBeenCalled();
  });

  it('closes the application links once an offer has been accepted', async () => {
    prisma.offerLetter.count.mockResolvedValue(1);

    await expect(service.createInvite('req-1', {}, hr)).rejects.toThrow(
      'accepted the offer',
    );
    expect(prisma.candidateApplicationInvite.create).not.toHaveBeenCalled();
  });

  describe('listApplications access', () => {
    const employee = (id: string, role: Role) => ({
      id,
      email: `${id}@phaze-dynamics.com`,
      role,
      verticalId: 'v-1',
    });

    beforeEach(() => {
      prisma.candidateApplication.findMany.mockResolvedValue([]);
    });

    it('allows the CEO even when neither HR, requester, nor vertical owner', async () => {
      prisma.candidateRequisition.findUnique.mockResolvedValue({
        requestedById: 'someone-else',
        vertical: { ownerId: 'another' },
      });
      prisma.employee.findUnique.mockResolvedValue({
        vertical: { code: 'ENG' },
      });

      await expect(
        service.listApplications('req-1', employee('ceo', Role.SUPER_ADMIN)),
      ).resolves.toEqual([]);
    });

    it("allows the requisition's vertical owner", async () => {
      prisma.candidateRequisition.findUnique.mockResolvedValue({
        requestedById: 'someone-else',
        vertical: { ownerId: 'owner-1' },
      });
      prisma.employee.findUnique.mockResolvedValue({
        vertical: { code: 'ENG' },
      });

      await expect(
        service.listApplications('req-1', employee('owner-1', Role.MANAGER)),
      ).resolves.toEqual([]);
    });

    it('allows the original requester', async () => {
      prisma.candidateRequisition.findUnique.mockResolvedValue({
        requestedById: 'req-user',
        vertical: { ownerId: 'another' },
      });
      prisma.employee.findUnique.mockResolvedValue({
        vertical: { code: 'ENG' },
      });

      await expect(
        service.listApplications('req-1', employee('req-user', Role.MANAGER)),
      ).resolves.toEqual([]);
    });

    it('rejects an unrelated non-HR employee', async () => {
      prisma.candidateRequisition.findUnique.mockResolvedValue({
        requestedById: 'someone-else',
        vertical: { ownerId: 'another' },
      });
      prisma.employee.findUnique.mockResolvedValue({
        vertical: { code: 'ENG' },
      });

      await expect(
        service.listApplications('req-1', employee('rando', Role.EMPLOYEE)),
      ).rejects.toThrow(/may view candidate applications/);
    });
  });

  describe('emailing the application link', () => {
    const liveInvite = (overrides: Record<string, unknown> = {}) => ({
      token: 'live-token',
      expiresAt: new Date(Date.now() + 86_400_000),
      revokedAt: null,
      passwordHash: null,
      ...overrides,
      // After the spread: a `requisition` override patches the base rather than
      // replacing it, so each gate case only has to name the field it changes.
      requisition: {
        requisitionNumber: 'REQ-2026-0001',
        positionTitle: 'Operations Manager',
        employmentType: 'FULL_TIME_PERMANENT',
        status: CandidateRequisitionStatus.APPROVED,
        hiringStage: CandidateHiringStage.JOB_POSTED,
        vertical: { name: 'Production' },
        offerLetters: [],
        ...((overrides.requisition as object) ?? {}),
      },
    });

    beforeEach(() => {
      email.send.mockImplementation(({ to }: any) =>
        Promise.resolve({ id: `msg-${to}`, recipients: [to], blocked: [] }),
      );
    });

    it('sends one separate email per candidate, never a shared To line', async () => {
      prisma.candidateApplicationInvite.findUnique.mockResolvedValue(
        liveInvite(),
      );

      const summary = await service.emailInvite(
        'invite-1',
        { to: ['one@example.com', 'two@example.com'] },
        hr,
      );

      expect(email.send).toHaveBeenCalledTimes(2);
      for (const call of email.send.mock.calls) {
        expect(typeof call[0].to).toBe('string');
      }
      expect(summary).toMatchObject({ sent: 2, skipped: 0, failed: 0 });
    });

    it('carries the public link and the role, and never the CTC budget', async () => {
      prisma.candidateApplicationInvite.findUnique.mockResolvedValue(
        liveInvite(),
      );

      await service.emailInvite('invite-1', { to: ['one@example.com'] }, hr);

      const sent = email.send.mock.calls[0][0];
      expect(sent.html).toContain(
        'https://app.example.com/public/job-applications/live-token',
      );
      expect(sent.subject).toContain('Operations Manager');
      expect(sent.html).toContain('Production');
      expect(sent.html).toContain('Full time permanent');
      // The requisition's internal hiring-plan figures are not an offer.
      expect(sent.html).not.toMatch(/4,?05,?000|budget|justification/i);
    });

    it('mails a duplicated address only once', async () => {
      prisma.candidateApplicationInvite.findUnique.mockResolvedValue(
        liveInvite(),
      );

      const summary = await service.emailInvite(
        'invite-1',
        { to: ['One@example.com', 'one@example.com'] },
        hr,
      );

      expect(email.send).toHaveBeenCalledTimes(1);
      expect(summary.sent).toBe(1);
    });

    it('reports one failed address without abandoning the rest', async () => {
      prisma.candidateApplicationInvite.findUnique.mockResolvedValue(
        liveInvite(),
      );
      email.send.mockImplementation(({ to }: any) =>
        to === 'bad@example.com'
          ? Promise.reject(new Error('Email send failed: invalid recipient'))
          : Promise.resolve({ id: 'msg-1', recipients: [to], blocked: [] }),
      );

      const summary = await service.emailInvite(
        'invite-1',
        { to: ['bad@example.com', 'good@example.com'] },
        hr,
      );

      expect(summary).toMatchObject({ sent: 1, failed: 1 });
      expect(summary.results[0]).toMatchObject({
        to: 'bad@example.com',
        status: 'failed',
      });
      expect(summary.results[1]).toMatchObject({
        to: 'good@example.com',
        status: 'sent',
      });
    });

    it('reports a held send as skipped rather than sent', async () => {
      prisma.candidateApplicationInvite.findUnique.mockResolvedValue(
        liveInvite(),
      );
      email.send.mockResolvedValue({
        id: null,
        recipients: [],
        blocked: ['one@example.com'],
        skipped: 'suppressed-by-allowlist',
      });

      const summary = await service.emailInvite(
        'invite-1',
        { to: ['one@example.com'] },
        hr,
      );

      expect(summary).toMatchObject({ sent: 0, skipped: 1 });
      expect(summary.results[0].reason).toBe('suppressed-by-allowlist');
    });

    it('says the password is shared separately, and never includes it', async () => {
      prisma.candidateApplicationInvite.findUnique.mockResolvedValue(
        liveInvite({ passwordHash: 'bcrypt-hash' }),
      );

      await service.emailInvite('invite-1', { to: ['one@example.com'] }, hr);

      const sent = email.send.mock.calls[0][0];
      expect(sent.html).toContain('password-protected');
      expect(sent.html).not.toContain('bcrypt-hash');
    });

    // Every gate the public form enforces is re-checked here: mailing a link
    // that greets the candidate with a rejection is worse than not mailing it.
    it.each([
      [
        'a revoked link',
        { revokedAt: new Date() },
        /revoked — generate a new one/,
      ],
      [
        'an expired link',
        { expiresAt: new Date(Date.now() - 1000) },
        /expired — generate a new one/,
      ],
      [
        'an unapproved requisition',
        {
          requisition: {
            status: CandidateRequisitionStatus.PENDING_SUPERADMIN_APPROVAL,
          },
        },
        /Only an Approved requisition/,
      ],
      [
        'a fulfilled requisition',
        {
          requisition: {
            hiringStage: CandidateHiringStage.CANDIDATE_SELECTED,
          },
        },
        /already Fulfilled/,
      ],
      [
        'a position whose candidate has accepted their offer',
        { requisition: { offerLetters: [{ id: 'offer-1' }] } },
        /accepted the offer for this position/,
      ],
    ])('refuses to mail %s', async (_label, overrides, message) => {
      prisma.candidateApplicationInvite.findUnique.mockResolvedValue(
        liveInvite(overrides),
      );

      await expect(
        service.emailInvite('invite-1', { to: ['one@example.com'] }, hr),
      ).rejects.toThrow(message);
      expect(email.send).not.toHaveBeenCalled();
    });

    it('is HR-only — a non-HR employee cannot mail candidates', async () => {
      prisma.employee.findUnique.mockResolvedValue({
        vertical: { code: 'ENG' },
      });

      await expect(
        service.emailInvite(
          'invite-1',
          { to: ['one@example.com'] },
          {
            id: 'rando',
            email: 'rando@phaze-dynamics.com',
            role: Role.EMPLOYEE,
            verticalId: 'eng-v',
          },
        ),
      ).rejects.toThrow(/Only HR/);
      expect(email.send).not.toHaveBeenCalled();
    });
  });
});
