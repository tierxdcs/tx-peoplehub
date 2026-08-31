import { ForbiddenException } from '@nestjs/common';
import { Prisma, RfqQuoteStatus, RfqStatus } from '@prisma/client';
import { RfqPublicService } from './rfq-public.service';

const D = (value: string | number) => new Prisma.Decimal(value);
const future = () => new Date(Date.now() + 7 * 86_400_000);
const past = (ms = 86_400_000) => new Date(Date.now() - ms);

/**
 * The vendor's half of a negotiated revision: a reopened link outlives the RFQ's
 * own deadline and the invitee's SUBMITTED lock, the next submission lands as a
 * NEW revision row seeded from the previous one, and the previous revision is
 * never written to.
 */
describe('RfqPublicService negotiated revision window', () => {
  let prisma: any;
  let tx: any;
  let quoteVault: any;
  let pushEvents: any;
  let service: RfqPublicService;

  /** Revision 1, submitted three days ago in the sealed round. */
  const revision1 = () => ({
    id: 'quote-rev1',
    inviteeId: 'invitee-1',
    revisionNumber: 1,
    submittedAt: past(3 * 86_400_000),
    quotedLeadTimeDays: 30,
    paymentTermsOffered: '30 days',
    validityDays: 45,
    notes: 'Sealed round offer.',
    attachmentFileKeys: ['rfq-quotes/invitee-1/attachments/aa'],
    totalQuotedValue: D('1000'),
    lines: [
      {
        id: 'ql-1',
        rfqLineId: 'line-1',
        unitPrice: D('100'),
        lineTotal: D('1000'),
        deliveryLeadTimeDays: 30,
        remarks: 'Ex-works',
      },
    ],
  });

  /** The invitee row validate() returns, with the newest revision attached. */
  const invitee = (overrides: Record<string, unknown> = {}) => ({
    id: 'invitee-1',
    rfqId: 'rfq-1',
    inviteToken: 'reopened-token',
    quoteStatus: RfqQuoteStatus.SUBMITTED,
    revokedAt: null,
    tokenExpiresAt: future(),
    passwordHash: null,
    revisionRequestedAt: past(),
    revisionDeadline: future(),
    revisionNote: 'Improve freight and lead time.',
    quotes: [{ revisionNumber: 1, submittedAt: past(3 * 86_400_000) }],
    rfq: {
      status: RfqStatus.CLOSED,
      submissionDeadline: past(5 * 86_400_000),
      awardedInviteeId: null,
    },
    ...overrides,
  });

  beforeEach(() => {
    tx = {
      rfqQuote: {
        findFirst: jest.fn().mockResolvedValue(revision1()),
        create: jest
          .fn()
          .mockImplementation(({ data }: any) =>
            Promise.resolve({ ...revision1(), ...data, id: 'quote-rev2' }),
          ),
        update: jest
          .fn()
          .mockImplementation(({ where }: any) =>
            Promise.resolve({ ...revision1(), id: where.id }),
          ),
      },
      rfqQuoteLine: { upsert: jest.fn(), findMany: jest.fn() },
      rfqLine: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'line-1', quantity: D(10) }]),
      },
      rfqInvitee: { update: jest.fn() },
    };
    prisma = {
      rfqInvitee: {
        findUnique: jest.fn().mockResolvedValue(invitee()),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ...invitee(),
          supplier: null,
          vendor: { companyName: 'Vigyanlabs Innovations' },
          supplierId: null,
          quotes: [revision1()],
          rfq: {
            rfqNumber: 'RFQ-2026-0007',
            status: RfqStatus.CLOSED,
            submissionDeadline: past(5 * 86_400_000),
            requiredByDate: null,
            deliveryLocation: null,
            paymentTermsRequested: null,
            lines: [
              {
                id: 'line-1',
                quantity: D(10),
                unitOfMeasure: 'NOS',
                specificationNotes: null,
                targetPrice: null,
                item: { itemCode: 'ITM-0001', name: 'Rack' },
              },
            ],
          },
        }),
        update: jest.fn(),
      },
      rfqLine: { findMany: jest.fn().mockResolvedValue([{ id: 'line-1' }]) },
      $transaction: jest.fn((cb: any) => cb(tx)),
    };
    quoteVault = { tryFileSubmittedQuote: jest.fn() };
    pushEvents = { rfqQuoteSubmitted: jest.fn() };
    service = new RfqPublicService(
      prisma,
      {} as never,
      { view: jest.fn().mockResolvedValue({ attachments: [] }) } as never,
      quoteVault,
      pushEvents,
    );
  });

  const submitDto = {
    lines: [{ rfqLineId: 'line-1', unitPrice: 90, deliveryLeadTimeDays: 20 }],
  };

  it('accepts a submission on a CLOSED RFQ while the window is open, as a NEW revision', async () => {
    await service.submit('reopened-token', submitDto as never);

    // Revision 2 is created — revision 1 is never the row being updated.
    expect(tx.rfqQuote.create).toHaveBeenCalledTimes(1);
    const created = tx.rfqQuote.create.mock.calls[0][0].data;
    expect(created).toMatchObject({
      inviteeId: 'invitee-1',
      revisionNumber: 2,
      // Seeded from the previous offer so a negotiation adjusts numbers.
      quotedLeadTimeDays: 30,
      paymentTermsOffered: '30 days',
      validityDays: 45,
    });
    expect(created.attachmentFileKeys).toEqual([
      'rfq-quotes/invitee-1/attachments/aa',
    ]);
    expect(created.lines.create).toEqual([
      expect.objectContaining({ rfqLineId: 'line-1', unitPrice: D('100') }),
    ]);

    // Every write targets revision 2's id.
    for (const call of tx.rfqQuote.update.mock.calls) {
      expect(call[0].where).toEqual({ id: 'quote-rev2' });
    }
    expect(tx.rfqQuoteLine.upsert.mock.calls[0][0].where).toEqual({
      quoteId_rfqLineId: { quoteId: 'quote-rev2', rfqLineId: 'line-1' },
    });

    // submittedAt is stamped on the revision itself, and on the invitee.
    const stamped = tx.rfqQuote.update.mock.calls.find(
      (c: any) => c[0].data.submittedAt,
    );
    expect(stamped[0].data.submittedAt).toBeInstanceOf(Date);
    expect(stamped[0].data.totalQuotedValue.toString()).toBe('900');
    expect(tx.rfqInvitee.update.mock.calls[0][0].data).toMatchObject({
      quoteStatus: RfqQuoteStatus.SUBMITTED,
    });
    expect(quoteVault.tryFileSubmittedQuote).toHaveBeenCalledWith('invitee-1');
    // The RFQ owner is told a revised number landed, not a first quote — the
    // window state is read before submittedAt is stamped, which is the only
    // point the two are still distinguishable.
    expect(pushEvents.rfqQuoteSubmitted).toHaveBeenCalledWith({
      inviteeId: 'invitee-1',
      isRevision: true,
    });
  });

  it('a save on a reopened link edits the draft revision without creating another', async () => {
    // Revision 2 already exists as an unsubmitted draft.
    tx.rfqQuote.findFirst.mockResolvedValue({
      ...revision1(),
      id: 'quote-rev2',
      revisionNumber: 2,
      submittedAt: null,
    });
    tx.rfqQuoteLine.findMany.mockResolvedValue([{ lineTotal: D('900') }]);

    await service.save('reopened-token', submitDto as never);

    expect(tx.rfqQuote.create).not.toHaveBeenCalled();
    expect(tx.rfqQuote.update.mock.calls[0][0].where).toEqual({
      id: 'quote-rev2',
    });
    // A draft revision carries no submittedAt, so it stays out of comparison.
    for (const call of tx.rfqQuote.update.mock.calls) {
      expect(call[0].data).not.toHaveProperty('submittedAt');
    }
    expect(tx.rfqInvitee.update).not.toHaveBeenCalled();
  });

  it('locks again once the requested revision has been submitted', async () => {
    prisma.rfqInvitee.findUnique.mockResolvedValue(
      invitee({
        // Revision 2 landed after the request.
        quotes: [{ revisionNumber: 2, submittedAt: new Date() }],
      }),
    );
    await expect(
      service.submit('reopened-token', submitDto as never),
    ).rejects.toThrow(/revised quote has already been submitted and is locked/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('closes when the revision deadline passes', async () => {
    prisma.rfqInvitee.findUnique.mockResolvedValue(
      invitee({
        revisionRequestedAt: past(2 * 86_400_000),
        revisionDeadline: past(),
      }),
    );
    await expect(
      service.submit('reopened-token', submitDto as never),
    ).rejects.toThrow(/window for submitting a revised quote has closed/);
  });

  it('a CLOSED RFQ with no revision requested stays shut (regression)', async () => {
    prisma.rfqInvitee.findUnique.mockResolvedValue(
      invitee({ revisionRequestedAt: null, revisionDeadline: null }),
    );
    await expect(
      service.submit('reopened-token', submitDto as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.rfqQuote.create).not.toHaveBeenCalled();
  });

  it('the sealed first round is unaffected: an ISSUED invitee creates revision 1', async () => {
    prisma.rfqInvitee.findUnique.mockResolvedValue(
      invitee({
        quoteStatus: RfqQuoteStatus.VIEWED,
        revisionRequestedAt: null,
        revisionDeadline: null,
        quotes: [],
        rfq: {
          status: RfqStatus.ISSUED,
          submissionDeadline: future(),
          awardedInviteeId: null,
        },
      }),
    );
    tx.rfqQuote.findFirst.mockResolvedValue(null);

    await service.submit('reopened-token', submitDto as never);

    expect(tx.rfqQuote.create.mock.calls[0][0].data).toEqual({
      inviteeId: 'invitee-1',
      revisionNumber: 1,
    });
  });

  it('exposes the revision window to the vendor portal, numbered as the one they will submit', async () => {
    const view = await service.resolve('reopened-token', {} as never);
    expect(view.revision).toMatchObject({
      open: true,
      // Revision 1 is submitted, so the vendor is about to send revision 2.
      revisionNumber: 2,
      note: 'Improve freight and lead time.',
    });
    expect(view.revision.deadline).toEqual(expect.any(String));
    // The portal still shows revision 1's numbers as the starting point.
    expect(view.quote?.totalQuotedValue).toBe('1000');
  });

  it('reports a shut window without inflating the revision number', async () => {
    prisma.rfqInvitee.findUnique.mockResolvedValue(
      invitee({ revisionRequestedAt: null, revisionDeadline: null }),
    );
    prisma.rfqInvitee.findUniqueOrThrow.mockResolvedValue({
      ...(await prisma.rfqInvitee.findUniqueOrThrow()),
      revisionRequestedAt: null,
      revisionDeadline: null,
      revisionNote: null,
    });

    const view = await service.resolve('reopened-token', {} as never);
    expect(view.revision).toMatchObject({
      open: false,
      revisionNumber: 1,
      note: null,
    });
  });
});
