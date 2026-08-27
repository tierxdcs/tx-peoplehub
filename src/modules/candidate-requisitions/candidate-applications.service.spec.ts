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
    $transaction: jest.fn((callback: any) => callback(prisma)),
  };
  const storage: any = {
    createUploadUrl: jest.fn(),
    headObject: jest.fn(),
    createDownloadUrl: jest.fn(),
  };
  const service = new CandidateApplicationsService(prisma, storage);
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
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.employee.findUnique.mockResolvedValue({ vertical: { code: 'HR' } });
    prisma.candidateRequisition.findUnique.mockResolvedValue(requisition);
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

  it('selecting an application fulfils the requisition and closes its links', async () => {
    prisma.candidateApplication.findUnique.mockResolvedValue({
      id: 'app-1',
      requisitionId: 'req-1',
      name: 'Selected Person',
      status: CandidateApplicationStatus.INTERVIEW_SCHEDULED,
      requisition,
    });
    prisma.candidateRequisition.update.mockResolvedValue({});
    prisma.candidateApplicationInvite.updateMany.mockResolvedValue({
      count: 1,
    });
    prisma.candidateApplication.update.mockResolvedValue({
      id: 'app-1',
      status: CandidateApplicationStatus.SELECTED,
    });

    await service.updateStatus(
      'app-1',
      CandidateApplicationStatus.SELECTED,
      hr,
    );

    expect(prisma.candidateRequisition.update).toHaveBeenCalledWith({
      where: { id: 'req-1' },
      data: {
        selectedCandidateName: 'Selected Person',
        hiringStage: CandidateHiringStage.CANDIDATE_SELECTED,
      },
    });
    expect(prisma.candidateApplicationInvite.updateMany).toHaveBeenCalled();
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
});
