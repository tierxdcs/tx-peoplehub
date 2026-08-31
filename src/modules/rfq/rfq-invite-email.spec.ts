import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RfqService } from './rfq.service';

/**
 * Emailing the RFQ quote links.
 *
 * The properties that matter: mailing sends the token the invitee ALREADY has
 * (a re-send must never invalidate a link a partner is working against), the
 * batch reports per invitee instead of failing as a whole, a partner whose link
 * is dead or who has already answered is skipped with a stated reason, and
 * naming an invitee explicitly overrides those courtesy skips.
 */
describe('RfqService.emailInvitees', () => {
  const now = new Date('2026-08-30T09:00:00.000Z');
  const deadline = new Date('2026-09-10T12:00:00.000Z');
  const user = { id: 'scm-1' } as never;

  let prisma: any;
  let access: any;
  let email: any;
  let config: any;
  let service: RfqService;

  const invitee = (overrides: Record<string, unknown> = {}) => ({
    id: 'invitee-1',
    inviteToken: 'tok-1',
    passwordHash: null,
    revokedAt: null,
    quoteStatus: 'INVITED',
    revisionRequestedAt: null,
    revisionDeadline: null,
    revisionNote: null,
    supplier: null,
    vendor: { companyName: 'Acme Metals', contactEmail: 'rfq@acme.test' },
    quotes: [],
    ...overrides,
  });

  const rfq = (overrides: Record<string, unknown> = {}) => ({
    rfqNumber: 'RFQ-2026-0042',
    title: 'Kiosk sheet metal',
    status: 'ISSUED',
    submissionDeadline: deadline,
    _count: { lines: 4 },
    invitees: [invitee()],
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      rfq: { findUnique: jest.fn().mockResolvedValue(rfq()) },
      financeCompanySettings: {
        findFirst: jest.fn().mockResolvedValue({ legalName: 'Phaze Dynamics' }),
      },
    };
    access = { assertCanManageRfqs: jest.fn() };
    email = {
      send: jest.fn().mockResolvedValue({
        id: 'msg-1',
        recipients: ['rfq@acme.test'],
        blocked: [],
      }),
    };
    config = {
      get: jest.fn((key: string) =>
        key === 'frontendOrigin' ? 'https://app.example.com/' : 'Asia/Kolkata',
      ),
    };
    service = new RfqService(
      prisma,
      access,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      email,
      config,
    );
  });

  const run = (dto: Record<string, unknown> = {}) =>
    service.emailInvitees('rfq-1', dto, user, now);

  it('mails the invitee their existing token and reports it sent', async () => {
    const summary = await run();

    expect(access.assertCanManageRfqs).toHaveBeenCalledWith(user);
    expect(email.send).toHaveBeenCalledTimes(1);
    const sent = email.send.mock.calls[0][0];
    expect(sent.to).toBe('rfq@acme.test');
    expect(sent.subject).toContain('RFQ-2026-0042');
    // The link is built from FRONTEND_ORIGIN, trailing slash stripped, and
    // carries the token the invitee was issued — mailing never mints a new one.
    expect(sent.html).toContain(
      'https://app.example.com/public/rfq-quote/tok-1',
    );
    expect(sent.text).toContain(
      'https://app.example.com/public/rfq-quote/tok-1',
    );
    expect(sent.tags).toEqual([{ name: 'kind', value: 'rfq-invite' }]);
    // A duplicate press is a deliberate re-send, so no idempotency key.
    expect(sent.idempotencyKey).toBeUndefined();

    expect(summary).toMatchObject({ sent: 1, skipped: 0, failed: 0 });
    expect(summary.results[0]).toMatchObject({
      inviteeId: 'invitee-1',
      partnerName: 'Acme Metals',
      to: 'rfq@acme.test',
      status: 'sent',
      reason: null,
      messageId: 'msg-1',
      revisionRequest: false,
    });
  });

  it('passes the buyer note through to every email', async () => {
    prisma.rfq.findUnique.mockResolvedValue(
      rfq({
        invitees: [
          invitee(),
          invitee({
            id: 'invitee-2',
            inviteToken: 'tok-2',
            vendor: null,
            supplier: {
              companyName: 'Bharat Fabrication',
              contactEmail: 'sales@bharat.test',
            },
          }),
        ],
      }),
    );

    const summary = await run({ note: 'Freight to be quoted separately.' });

    expect(summary.sent).toBe(2);
    for (const call of email.send.mock.calls) {
      expect(call[0].text).toContain('Freight to be quoted separately.');
    }
    expect(email.send.mock.calls[1][0].to).toBe('sales@bharat.test');
  });

  it('never puts the link password in the body', async () => {
    prisma.rfq.findUnique.mockResolvedValue(
      rfq({ invitees: [invitee({ passwordHash: '$2b$10$abcdefghijklmno' })] }),
    );

    await run();

    const sent = email.send.mock.calls[0][0];
    expect(sent.text).toContain('The link is password-protected.');
    expect(sent.text).not.toContain('$2b$10');
    expect(sent.html).not.toContain('$2b$10');
  });

  describe('when the RFQ cannot be mailed at all', () => {
    it('404s an unknown RFQ', async () => {
      prisma.rfq.findUnique.mockResolvedValue(null);
      await expect(run()).rejects.toThrow(NotFoundException);
    });

    it('refuses a DRAFT — the links do not exist until issue', async () => {
      prisma.rfq.findUnique.mockResolvedValue(rfq({ status: 'DRAFT' }));
      await expect(run()).rejects.toThrow(/Issue the RFQ first/);
      expect(email.send).not.toHaveBeenCalled();
    });

    it('refuses an AWARDED or CANCELLED RFQ', async () => {
      prisma.rfq.findUnique.mockResolvedValue(rfq({ status: 'AWARDED' }));
      await expect(run()).rejects.toThrow(/awarded/);
      prisma.rfq.findUnique.mockResolvedValue(rfq({ status: 'CANCELLED' }));
      await expect(run()).rejects.toThrow(/cancelled/);
    });

    it('refuses an RFQ with no invitees', async () => {
      prisma.rfq.findUnique.mockResolvedValue(rfq({ invitees: [] }));
      await expect(run()).rejects.toThrow(BadRequestException);
    });

    it('404s ids that are not invitees on this RFQ', async () => {
      await expect(run({ inviteeIds: ['invitee-1', 'ghost'] })).rejects.toThrow(
        NotFoundException,
      );
      expect(email.send).not.toHaveBeenCalled();
    });
  });

  describe('per-invitee skips', () => {
    const expectSkip = async (
      overrides: Record<string, unknown>,
      reason: string,
      rfqOverrides: Record<string, unknown> = {},
    ) => {
      prisma.rfq.findUnique.mockResolvedValue(
        rfq({ invitees: [invitee(overrides)], ...rfqOverrides }),
      );
      const summary = await run();
      expect(email.send).not.toHaveBeenCalled();
      expect(summary).toMatchObject({ sent: 0, skipped: 1, failed: 0 });
      expect(summary.results[0]).toMatchObject({ status: 'skipped', reason });
    };

    it('skips a revoked invitee', () =>
      expectSkip(
        { revokedAt: new Date('2026-08-20T00:00:00.000Z') },
        'revoked',
      ));

    it('skips a placeholder token (never issued)', () =>
      // addInvitee stores `pending:<token>`; only issue() mints a real one.
      expectSkip({ inviteToken: 'pending:tok-1' }, 'link-not-issued'));

    it('skips everyone on a CLOSED RFQ with no revision pending', () =>
      expectSkip({}, 'link-closed', { status: 'CLOSED' }));

    it('skips once the submission deadline has passed', () =>
      expectSkip({}, 'deadline-passed', {
        submissionDeadline: new Date('2026-08-01T00:00:00.000Z'),
      }));

    it('skips an invitee with no usable contact email', () =>
      expectSkip(
        { vendor: { companyName: 'Acme Metals', contactEmail: '  ' } },
        'no-contact-email',
      ));

    it('skips a partner who has already answered on a blanket send', async () => {
      prisma.rfq.findUnique.mockResolvedValue(
        rfq({
          invitees: [
            invitee({ id: 'a', quoteStatus: 'SUBMITTED' }),
            invitee({ id: 'b', quoteStatus: 'DECLINED' }),
            invitee({ id: 'c', quoteStatus: 'VIEWED' }),
          ],
        }),
      );

      const summary = await run();

      expect(summary).toMatchObject({ sent: 1, skipped: 2 });
      expect(
        summary.results.map((r) => [r.inviteeId, r.status, r.reason]),
      ).toEqual([
        ['a', 'skipped', 'already-submitted'],
        ['b', 'skipped', 'declined'],
        ['c', 'sent', null],
      ]);
    });

    it('mails a named invitee even though they already answered', async () => {
      // Naming ids is a deliberate choice by the buyer, so it lifts the
      // courtesy skips — but never the skips for a link that cannot work.
      prisma.rfq.findUnique.mockResolvedValue(
        rfq({ invitees: [invitee({ quoteStatus: 'DECLINED' })] }),
      );

      const summary = await run({ inviteeIds: ['invitee-1'] });

      expect(summary).toMatchObject({ sent: 1, skipped: 0 });
      expect(email.send).toHaveBeenCalledTimes(1);
    });

    it('still skips a revoked link when it is named explicitly', async () => {
      prisma.rfq.findUnique.mockResolvedValue(
        rfq({ invitees: [invitee({ revokedAt: now })] }),
      );

      const summary = await run({ inviteeIds: ['invitee-1'] });

      expect(summary.results[0]).toMatchObject({
        status: 'skipped',
        reason: 'revoked',
      });
    });

    it('reports a provider skip (dry-run/allowlist) faithfully, not as sent', async () => {
      email.send.mockResolvedValue({
        id: null,
        recipients: [],
        blocked: ['rfq@acme.test'],
        skipped: 'suppressed-by-allowlist',
      });

      const summary = await run();

      expect(summary).toMatchObject({ sent: 0, skipped: 1, failed: 0 });
      expect(summary.results[0]).toMatchObject({
        status: 'skipped',
        reason: 'suppressed-by-allowlist',
        messageId: null,
      });
    });
  });

  describe('a revision-request recipient', () => {
    const revisionDeadline = new Date('2026-09-15T12:00:00.000Z');
    const revising = (overrides: Record<string, unknown> = {}) =>
      invitee({
        quoteStatus: 'SUBMITTED',
        revisionRequestedAt: new Date('2026-08-29T00:00:00.000Z'),
        revisionDeadline,
        revisionNote: 'Re-quote lines 2 and 3 at 500 units.',
        quotes: [{ submittedAt: new Date('2026-08-20T00:00:00.000Z') }],
        ...overrides,
      });

    it('gets the revision email with the revision deadline and ask', async () => {
      prisma.rfq.findUnique.mockResolvedValue(
        rfq({ status: 'CLOSED', invitees: [revising()] }),
      );

      const summary = await run();

      const sent = email.send.mock.calls[0][0];
      expect(sent.subject).toContain('Revised quote requested');
      expect(sent.text).toContain(
        'What we are asking for: Re-quote lines 2 and 3 at 500 units.',
      );
      expect(sent.text).toContain('Your earlier link has been replaced');
      expect(sent.text).toMatch(/15 Sept? 2026/);
      expect(sent.tags).toEqual([
        { name: 'kind', value: 'rfq-revision-request' },
      ]);
      expect(summary.results[0]).toMatchObject({
        status: 'sent',
        revisionRequest: true,
      });
    });

    it('is mailed on a CLOSED RFQ past the submission deadline', async () => {
      // The revision window is the only thing keeping this link alive, so
      // neither the closed status nor the elapsed deadline may skip them.
      prisma.rfq.findUnique.mockResolvedValue(
        rfq({
          status: 'CLOSED',
          submissionDeadline: new Date('2026-08-01T00:00:00.000Z'),
          invitees: [revising()],
        }),
      );

      expect(await run()).toMatchObject({ sent: 1, skipped: 0 });
    });

    it('falls back to the invitation once the revision window has closed', async () => {
      prisma.rfq.findUnique.mockResolvedValue(
        rfq({
          invitees: [
            revising({
              revisionDeadline: new Date('2026-08-25T00:00:00.000Z'),
            }),
          ],
        }),
      );

      const summary = await run({ inviteeIds: ['invitee-1'] });

      expect(email.send.mock.calls[0][0].subject).toContain(
        'Request for Quotation',
      );
      expect(summary.results[0].revisionRequest).toBe(false);
    });
  });

  it('one provider failure does not stop the rest of the batch', async () => {
    prisma.rfq.findUnique.mockResolvedValue(
      rfq({
        invitees: [
          invitee({ id: 'a', inviteToken: 'tok-a' }),
          invitee({ id: 'b', inviteToken: 'tok-b' }),
          invitee({ id: 'c', inviteToken: 'tok-c' }),
        ],
      }),
    );
    email.send
      .mockResolvedValueOnce({ id: 'msg-a', recipients: [], blocked: [] })
      .mockRejectedValueOnce(new Error('The domain is not verified.'))
      .mockResolvedValueOnce({ id: 'msg-c', recipients: [], blocked: [] });

    const summary = await run();

    expect(email.send).toHaveBeenCalledTimes(3);
    expect(summary).toMatchObject({ sent: 2, skipped: 0, failed: 1 });
    expect(summary.results[1]).toMatchObject({
      inviteeId: 'b',
      status: 'failed',
      reason: 'The domain is not verified.',
      messageId: null,
    });
  });
});
