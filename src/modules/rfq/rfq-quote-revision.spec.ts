import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RfqService } from './rfq.service';

const D = (value: string | number) => new Prisma.Decimal(value);
const future = () => new Date(Date.now() + 7 * 86_400_000);
const past = () => new Date(Date.now() - 86_400_000);

/**
 * Reopening ONE vendor's link for a negotiated revised quote.
 *
 * The properties worth pinning down: the reopen is scoped to a single invitee
 * (never the RFQ, never a second invitee), the RFQ's PM approval is not
 * disturbed, and comparison/award read each invitee's LATEST submitted revision
 * while the earlier ones stay intact and visible.
 */
describe('RfqService negotiated quote revisions', () => {
  let prisma: any;
  let access: any;
  let service: RfqService;
  const user = { id: 'scm-1' } as never;

  /** An invitee who submitted revision 1 in the sealed round. */
  const submittedInvitee = (overrides: Record<string, unknown> = {}) => ({
    id: 'invitee-1',
    rfqId: 'rfq-1',
    quoteStatus: 'SUBMITTED',
    revokedAt: null,
    revisionRequestedAt: null,
    revisionDeadline: null,
    supplier: null,
    vendor: { companyName: 'Vigyanlabs Innovations' },
    quotes: [{ revisionNumber: 1, submittedAt: past() }],
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      rfq: { findUnique: jest.fn().mockResolvedValue({ status: 'CLOSED' }) },
      rfqInvitee: {
        findFirst: jest.fn().mockResolvedValue(submittedInvitee()),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
    };
    access = {
      assertCanManageRfqs: jest.fn(),
      assertCanReadRfqs: jest.fn(),
      assertCanAward: jest.fn(),
    };
    service = new RfqService(
      prisma,
      access,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { approvalRequired: jest.fn() } as never,
    );
    jest
      .spyOn(service, 'get')
      .mockResolvedValue({ id: 'rfq-1' } as unknown as never);
  });

  const deadline = () => ({ revisionDeadline: future().toISOString() });

  describe('requestQuoteRevision', () => {
    it('reopens only the targeted invitee: fresh token, window fields, nothing on the RFQ', async () => {
      await service.requestQuoteRevision(
        'rfq-1',
        'invitee-1',
        { ...deadline(), note: '  Improve freight  ' },
        user,
      );

      expect(access.assertCanManageRfqs).toHaveBeenCalledWith(user);
      // Exactly one invitee row is written, matched by its own id.
      expect(prisma.rfqInvitee.update).toHaveBeenCalledTimes(1);
      const call = prisma.rfqInvitee.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'invitee-1' });
      // Scoped lookup: the invitee must belong to THIS RFQ.
      expect(prisma.rfqInvitee.findFirst.mock.calls[0][0].where).toEqual({
        id: 'invitee-1',
        rfqId: 'rfq-1',
      });
      expect(call.data.inviteToken).toEqual(expect.any(String));
      expect(call.data.inviteToken).not.toMatch(/^pending:/);
      expect(call.data.revisionRequestedById).toBe('scm-1');
      expect(call.data.revisionRequestedAt).toBeInstanceOf(Date);
      // The reopened link expires exactly when the revision window does.
      expect(call.data.tokenExpiresAt).toEqual(call.data.revisionDeadline);
      expect(call.data.revisionNote).toBe('Improve freight');
      // §4 assumption: this is an SCM operational action — no fresh PM approval.
      expect(call.data).not.toHaveProperty('pmApprovedById');
      expect(call.data).not.toHaveProperty('pmApprovedAt');
      expect(call.data).not.toHaveProperty('status');
    });

    it('keeps the existing password unless a new one is supplied', async () => {
      await service.requestQuoteRevision(
        'rfq-1',
        'invitee-1',
        deadline(),
        user,
      );
      expect(prisma.rfqInvitee.update.mock.calls[0][0].data).not.toHaveProperty(
        'passwordHash',
      );

      await service.requestQuoteRevision(
        'rfq-1',
        'invitee-1',
        { ...deadline(), password: 'new-secret' },
        user,
      );
      const hash = prisma.rfqInvitee.update.mock.calls[1][0].data.passwordHash;
      expect(typeof hash).toBe('string');
      expect(hash).not.toBe('new-secret');
    });

    it('is CLOSED-only, with a distinct message once awarded', async () => {
      prisma.rfq.findUnique.mockResolvedValue({ status: 'ISSUED' });
      await expect(
        service.requestQuoteRevision('rfq-1', 'invitee-1', deadline(), user),
      ).rejects.toThrow(/only be requested on a CLOSED RFQ/);

      prisma.rfq.findUnique.mockResolvedValue({ status: 'AWARDED' });
      await expect(
        service.requestQuoteRevision('rfq-1', 'invitee-1', deadline(), user),
      ).rejects.toThrow(/already been awarded/);
      expect(prisma.rfqInvitee.update).not.toHaveBeenCalled();
    });

    it('refuses an invitee that is not on this RFQ', async () => {
      prisma.rfqInvitee.findFirst.mockResolvedValue(null);
      await expect(
        service.requestQuoteRevision(
          'rfq-1',
          'other-invitee',
          deadline(),
          user,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('will not solicit a first quote after the close (decliner / non-responder / revoked)', async () => {
      for (const invitee of [
        submittedInvitee({ quoteStatus: 'DECLINED' }),
        submittedInvitee({ quoteStatus: 'VIEWED', quotes: [] }),
        // Submitted per the invitee row, but the revision itself is still a draft.
        submittedInvitee({
          quotes: [{ revisionNumber: 2, submittedAt: null }],
        }),
      ]) {
        prisma.rfqInvitee.findFirst.mockResolvedValue(invitee);
        await expect(
          service.requestQuoteRevision('rfq-1', 'invitee-1', deadline(), user),
        ).rejects.toThrow(/invitee who submitted one/);
      }

      prisma.rfqInvitee.findFirst.mockResolvedValue(
        submittedInvitee({ revokedAt: past() }),
      );
      await expect(
        service.requestQuoteRevision('rfq-1', 'invitee-1', deadline(), user),
      ).rejects.toThrow(/access was revoked/);
      expect(prisma.rfqInvitee.update).not.toHaveBeenCalled();
    });

    it('refuses a second request while one is still outstanding, and allows it once the window lapsed', async () => {
      const requestedAt = new Date();
      prisma.rfqInvitee.findFirst.mockResolvedValue(
        submittedInvitee({
          revisionRequestedAt: requestedAt,
          revisionDeadline: future(),
        }),
      );
      await expect(
        service.requestQuoteRevision('rfq-1', 'invitee-1', deadline(), user),
      ).rejects.toThrow(/already been requested/);

      // Deadline passed with no revision submitted — SCM may re-request.
      prisma.rfqInvitee.findFirst.mockResolvedValue(
        submittedInvitee({
          revisionRequestedAt: past(),
          revisionDeadline: past(),
        }),
      );
      await service.requestQuoteRevision(
        'rfq-1',
        'invitee-1',
        deadline(),
        user,
      );
      expect(prisma.rfqInvitee.update).toHaveBeenCalledTimes(1);
    });

    it('allows the NEXT round once the requested revision has been submitted', async () => {
      const requestedAt = new Date(Date.now() - 3 * 86_400_000);
      prisma.rfqInvitee.findFirst.mockResolvedValue(
        submittedInvitee({
          revisionRequestedAt: requestedAt,
          revisionDeadline: future(),
          // Revision 2 landed after the request, so nothing is outstanding.
          quotes: [{ revisionNumber: 2, submittedAt: new Date() }],
        }),
      );
      await service.requestQuoteRevision(
        'rfq-1',
        'invitee-1',
        deadline(),
        user,
      );
      expect(prisma.rfqInvitee.update).toHaveBeenCalledTimes(1);
    });

    it('rejects a deadline that is absent from the future', async () => {
      await expect(
        service.requestQuoteRevision(
          'rfq-1',
          'invitee-1',
          { revisionDeadline: past().toISOString() },
          user,
        ),
      ).rejects.toThrow(/must be in the future/);
      await expect(
        service.requestQuoteRevision(
          'rfq-1',
          'invitee-1',
          { revisionDeadline: 'not-a-date' },
          user,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.rfqInvitee.update).not.toHaveBeenCalled();
    });
  });

  describe('comparison and award read the latest revision', () => {
    const quote = (
      revisionNumber: number,
      total: string,
      unitPrice: string,
      leadTime: number,
    ) => ({
      id: `q-${revisionNumber}`,
      revisionNumber,
      submittedAt: new Date(`2026-09-0${revisionNumber}T00:00:00.000Z`),
      totalQuotedValue: D(total),
      quotedLeadTimeDays: leadTime,
      paymentTermsOffered: null,
      validityDays: null,
      attachmentFileKeys: [],
      lines: [
        {
          id: `ql-${revisionNumber}`,
          rfqLineId: 'line-1',
          unitPrice: D(unitPrice),
          lineTotal: D(total),
        },
      ],
    });

    /** A negotiated vendor (rev 2 cheaper) against a one-shot vendor. */
    function twoInvitees() {
      return [
        {
          id: 'invitee-1',
          supplierId: null,
          vendorId: 'vendor-1',
          supplier: null,
          vendor: { companyName: 'Negotiated Vendor' },
          qualificationStatusSnapshot: 'APPROVED',
          quoteStatus: 'SUBMITTED',
          declineReason: null,
          // Newest first, exactly as the service's orderBy returns them.
          quotes: [quote(2, '900', '90', 20), quote(1, '1000', '100', 30)],
        },
        {
          id: 'invitee-2',
          supplierId: null,
          vendorId: 'vendor-2',
          supplier: null,
          vendor: { companyName: 'One-shot Vendor' },
          qualificationStatusSnapshot: 'APPROVED',
          quoteStatus: 'SUBMITTED',
          declineReason: null,
          quotes: [quote(1, '950', '95', 25)],
        },
      ];
    }

    beforeEach(() => {
      prisma.rfq.findUnique = jest.fn().mockResolvedValue({
        id: 'rfq-1',
        rfqNumber: 'RFQ-2026-0007',
        status: 'CLOSED',
        submissionDeadline: past(),
        lines: [
          {
            id: 'line-1',
            itemId: 'item-1',
            quantity: D(10),
            unitOfMeasure: 'NOS',
            item: { itemCode: 'ITM-0001', name: 'Rack' },
          },
        ],
        invitees: [],
        attachments: [],
      });
      prisma.rfqInvitee.findMany.mockResolvedValue(twoInvitees());
    });

    it('only counts submitted revisions and keeps the full history per column', async () => {
      const result = await service.comparison('rfq-1', {}, user);

      // A draft revision must never reach the grid.
      expect(
        prisma.rfqInvitee.findMany.mock.calls[0][0].include.quotes,
      ).toEqual(
        expect.objectContaining({
          where: { submittedAt: { not: null } },
          orderBy: { revisionNumber: 'desc' },
        }),
      );

      const negotiated = result.columns[0];
      // Figures come from revision 2 — the offer on the table.
      expect(negotiated.revisionNumber).toBe(2);
      expect(negotiated.totalQuotedValue).toBe('900');
      expect(negotiated.lines[0].unitPrice).toBe('90');
      // …and revision 1 is still there, unmodified, for the audit trail.
      expect(negotiated.revisions.map((r) => r.revisionNumber)).toEqual([2, 1]);
      expect(negotiated.revisions[1]).toMatchObject({
        revisionNumber: 1,
        totalQuotedValue: '1000',
        quotedLeadTimeDays: 30,
      });

      // The negotiated 900 beats the other vendor's 950 — lowest is judged on
      // latest revisions, not on the sealed-round numbers (where 950 < 1000).
      expect(negotiated.isLowestTotal).toBe(true);
      expect(negotiated.lines[0].isLowestUnitPrice).toBe(true);
      expect(result.columns[1].isLowestTotal).toBe(false);
      expect(result.columns[1].revisionNumber).toBe(1);
      expect(result.columns[1].varianceVsLowest).toBe('50');
    });

    it('a non-responder carries no revision at all', async () => {
      prisma.rfqInvitee.findMany.mockResolvedValue([
        ...twoInvitees(),
        {
          id: 'invitee-3',
          supplierId: null,
          vendorId: 'vendor-3',
          supplier: null,
          vendor: { companyName: 'Silent Vendor' },
          qualificationStatusSnapshot: 'APPROVED',
          quoteStatus: 'VIEWED',
          declineReason: null,
          quotes: [],
        },
      ]);
      const result = await service.comparison('rfq-1', {}, user);
      expect(result.columns[2]).toMatchObject({
        nonResponder: true,
        revisionNumber: null,
        revisions: [],
        totalQuotedValue: null,
      });
    });

    it('awards the latest revision and notes it on the drafted PO', async () => {
      const [negotiated] = twoInvitees();
      prisma.rfqInvitee.findFirst = jest.fn().mockResolvedValue({
        ...negotiated,
        supplierId: null,
        vendorId: 'vendor-1',
        // The service takes only the newest submitted revision here.
        quotes: [quote(2, '900', '90', 20)],
      });
      prisma.rfqInvitee.findMany.mockResolvedValue([
        { id: 'invitee-1', quotes: [{ totalQuotedValue: D('900') }] },
        { id: 'invitee-2', quotes: [{ totalQuotedValue: D('950') }] },
      ]);
      const po = { id: 'po-1' };
      const purchaseOrders = { create: jest.fn().mockResolvedValue(po) };
      (service as any).purchaseOrders = purchaseOrders;
      prisma.$transaction = jest.fn(async (cb: any) =>
        cb({
          rfq: { update: jest.fn() },
          itemQuotedCost: { createMany: jest.fn() },
        }),
      );

      const result = await service.award(
        'rfq-1',
        { inviteeId: 'invitee-1' },
        user,
      );

      expect(result.purchaseOrderId).toBe('po-1');
      const poDto = purchaseOrders.create.mock.calls[0][0];
      // Revision 2's price, and the revision is named on the PO.
      expect(poDto.lines[0].unitPrice).toBe(90);
      expect(poDto.notes).toContain('quote revision 2');
      // 900 IS the lowest across latest revisions, so no justification needed.
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('still requires a justification when the latest revision is not the lowest', async () => {
      prisma.rfqInvitee.findFirst = jest.fn().mockResolvedValue({
        ...twoInvitees()[0],
        quotes: [quote(2, '980', '98', 20)],
      });
      prisma.rfqInvitee.findMany.mockResolvedValue([
        { id: 'invitee-1', quotes: [{ totalQuotedValue: D('980') }] },
        { id: 'invitee-2', quotes: [{ totalQuotedValue: D('950') }] },
      ]);
      await expect(
        service.award('rfq-1', { inviteeId: 'invitee-1' }, user),
      ).rejects.toThrow(/justification is required/);
    });
  });
});
