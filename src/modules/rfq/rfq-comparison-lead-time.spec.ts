import { Prisma } from '@prisma/client';
import { RfqService, effectiveLeadTimeDays } from './rfq.service';

const D = (value: string | number) => new Prisma.Decimal(value);
const past = () => new Date(Date.now() - 86_400_000);

describe('effectiveLeadTimeDays', () => {
  it('prefers the quote-level figure when the vendor stated one', () => {
    expect(
      effectiveLeadTimeDays({
        quotedLeadTimeDays: 14,
        lines: [{ deliveryLeadTimeDays: 30 }],
      }),
    ).toEqual({ days: 14, fromLines: false });
  });

  it('falls back to the SLOWEST line — the order lands when the last one does', () => {
    expect(
      effectiveLeadTimeDays({
        quotedLeadTimeDays: null,
        lines: [
          { deliveryLeadTimeDays: 12 },
          { deliveryLeadTimeDays: 30 },
          { deliveryLeadTimeDays: null },
        ],
      }),
    ).toEqual({ days: 30, fromLines: true });
  });

  it('reports nothing when neither was filled in', () => {
    expect(
      effectiveLeadTimeDays({
        quotedLeadTimeDays: null,
        lines: [{ deliveryLeadTimeDays: null }],
      }),
    ).toEqual({ days: null, fromLines: false });
  });

  it('treats an explicit zero as a real answer, not a missing one', () => {
    expect(
      effectiveLeadTimeDays({
        quotedLeadTimeDays: 0,
        lines: [{ deliveryLeadTimeDays: 30 }],
      }),
    ).toEqual({ days: 0, fromLines: false });
  });
});

/**
 * The real-world shape this fixes: both vendors filled the per-line delivery
 * lead time beside the price and left the Quote Terms summary field blank. Read
 * only from the summary field, the comparison showed "—" AND scored both quotes'
 * lead time as best-in-class — handing the whole lead-time weight out for free
 * and hiding that the cheaper vendor is also the slower one.
 */
describe('RfqService.comparison lead time from the quote lines', () => {
  let prisma: any;
  let service: RfqService;
  const user = { id: 'scm-1' } as never;

  /** Quote with no summary lead time, carrying it on the line instead. */
  const lineOnlyQuote = (total: string, lineLeadDays: number) => ({
    id: `q-${total}`,
    revisionNumber: 1,
    submittedAt: past(),
    totalQuotedValue: D(total),
    quotedLeadTimeDays: null,
    paymentTermsOffered: null,
    validityDays: null,
    attachmentFileKeys: [],
    lines: [
      {
        id: `ql-${total}`,
        rfqLineId: 'line-1',
        unitPrice: D(total),
        lineTotal: D(total),
        deliveryLeadTimeDays: lineLeadDays,
      },
    ],
  });

  beforeEach(() => {
    prisma = {
      rfq: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'rfq-1',
          rfqNumber: 'RFQ-2026-0003',
          status: 'CLOSED',
          submissionDeadline: past(),
          lines: [
            {
              id: 'line-1',
              itemId: 'item-1',
              quantity: D(1),
              unitOfMeasure: 'each',
              item: { itemCode: 'CM-00003', name: 'c13 socket' },
            },
          ],
          invitees: [],
          attachments: [],
        }),
      },
      rfqInvitee: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'invitee-1',
            supplierId: null,
            vendorId: 'vendor-1',
            supplier: null,
            vendor: { companyName: 'Cheaper but slower' },
            qualificationStatusSnapshot: 'APPROVED',
            quoteStatus: 'SUBMITTED',
            declineReason: null,
            quotes: [lineOnlyQuote('39000', 30)],
          },
          {
            id: 'invitee-2',
            supplierId: null,
            vendorId: 'vendor-2',
            supplier: null,
            vendor: { companyName: 'Dearer but faster' },
            qualificationStatusSnapshot: 'PENDING_QUESTIONNAIRE',
            quoteStatus: 'SUBMITTED',
            declineReason: null,
            quotes: [lineOnlyQuote('39500', 26)],
          },
        ]),
      },
    };
    service = new RfqService(
      prisma,
      {
        assertCanReadRfqs: jest.fn(),
        assertCanManageRfqs: jest.fn(),
        assertCanAward: jest.fn(),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { refreshReleasedSnapshots: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      { approvalRequired: jest.fn() } as never,
    );
  });

  it('surfaces the line lead times, flagged as derived', async () => {
    const result = await service.comparison('rfq-1', {}, user);

    expect(result.columns[0]).toMatchObject({
      quotedLeadTimeDays: 30,
      leadTimeFromLines: true,
    });
    expect(result.columns[1]).toMatchObject({
      quotedLeadTimeDays: 26,
      leadTimeFromLines: true,
    });
  });

  it('scores the derived spread instead of gifting everyone a perfect lead time', async () => {
    const result = await service.comparison('rfq-1', {}, user);

    // 60/20/20. Slower vendor: price 1 · lead 0 (worst of 30 vs 26) · qual .85
    // → 0.6 + 0 + 0.17. Faster: price 39000/39500 · lead 1 · qual .1.
    expect(result.columns[0].weightedScore).toBe('77.0');
    expect(result.columns[1].weightedScore).toBe('81.2');
  });

  it('marks a stated summary lead time as its own, not derived', async () => {
    prisma.rfqInvitee.findMany.mockResolvedValue([
      {
        id: 'invitee-1',
        supplierId: null,
        vendorId: 'vendor-1',
        supplier: null,
        vendor: { companyName: 'Stated overall' },
        qualificationStatusSnapshot: 'APPROVED',
        quoteStatus: 'SUBMITTED',
        declineReason: null,
        quotes: [{ ...lineOnlyQuote('39000', 30), quotedLeadTimeDays: 21 }],
      },
    ]);

    const result = await service.comparison('rfq-1', {}, user);

    expect(result.columns[0]).toMatchObject({
      quotedLeadTimeDays: 21,
      leadTimeFromLines: false,
    });
  });

  it('carries the derived figure into the revision trail too', async () => {
    const result = await service.comparison('rfq-1', {}, user);
    expect(result.columns[0].revisions[0].quotedLeadTimeDays).toBe(30);
  });
});
