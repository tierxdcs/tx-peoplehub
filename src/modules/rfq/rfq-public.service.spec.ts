import { ForbiddenException } from '@nestjs/common';
import { RfqQuoteStatus, RfqStatus } from '@prisma/client';
import { RfqPublicService } from './rfq-public.service';

describe('RfqPublicService technical access after award', () => {
  let prisma: any;
  let technical: any;
  let service: RfqPublicService;

  beforeEach(() => {
    prisma = {
      rfqInvitee: { findUnique: jest.fn() },
    };
    technical = { download: jest.fn() };
    service = new RfqPublicService(prisma, {} as never, technical, {
      tryFileSubmittedQuote: jest.fn(),
    } as never);
  });

  const invite = (id: string, winnerId: string) => ({
    id,
    rfqId: 'rfq-1',
    inviteToken: 'valid-token',
    quoteStatus: RfqQuoteStatus.SUBMITTED,
    revokedAt: null,
    tokenExpiresAt: new Date(Date.now() + 60_000),
    passwordHash: null,
    rfq: {
      status: RfqStatus.AWARDED,
      submissionDeadline: new Date(Date.now() - 60_000),
      awardedInviteeId: winnerId,
    },
  });

  it('denies a non-winning invitee before generating a presigned URL', async () => {
    prisma.rfqInvitee.findUnique.mockResolvedValue(
      invite('loser-invite', 'winner-invite'),
    );

    await expect(
      service.technicalDownload('valid-token', {
        attachmentId: 'drawing-1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(technical.download).not.toHaveBeenCalled();
  });

  it('retains technical access for the winning invitee', async () => {
    prisma.rfqInvitee.findUnique.mockResolvedValue(
      invite('winner-invite', 'winner-invite'),
    );
    technical.download.mockResolvedValue({
      url: 'https://short-lived.example/drawing',
      expiresInSeconds: 300,
      fileName: 'drawing.pdf',
    });

    await expect(
      service.technicalDownload('valid-token', {
        attachmentId: 'drawing-1',
      }),
    ).resolves.toMatchObject({ expiresInSeconds: 300 });
    expect(technical.download).toHaveBeenCalledWith('rfq-1', 'drawing-1');
  });
});
