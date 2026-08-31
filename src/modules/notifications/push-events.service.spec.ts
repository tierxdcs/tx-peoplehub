import { EmployeeStatus, Role } from '@prisma/client';
import { PushEventsService } from './push-events.service';

/**
 * The two things this service is responsible for: WHO gets a push, and the
 * promise that nothing it does can ever reach the caller. The wording of each
 * notification is push-triggers.spec.ts's job.
 */
describe('PushEventsService', () => {
  let prisma: any;
  let push: any;
  let service: PushEventsService;

  beforeEach(() => {
    prisma = {
      employee: { findMany: jest.fn(), findUnique: jest.fn() },
      rfqInvitee: { findUnique: jest.fn() },
      designReview: { findUnique: jest.fn() },
      order: { findUnique: jest.fn() },
      deliveryChallan: { findUnique: jest.fn() },
    };
    push = {
      trySendToEmployee: jest.fn().mockResolvedValue(undefined),
      trySendToEmployees: jest.fn().mockResolvedValue([]),
    };
    service = new PushEventsService(prisma, push);
  });

  // ── Recipient resolution ─────────────────────────────────────────────

  describe('approvalRequired', () => {
    it('resolves an approver pool to active holders only', async () => {
      prisma.employee.findMany.mockResolvedValue([
        { id: 'head' },
        { id: 'sa' },
      ]);
      prisma.employee.findUnique.mockResolvedValue({
        firstName: 'Nithin',
        lastName: 'Raj',
      });
      await service.approvalRequired({
        kind: 'expense-claim',
        audience: { pool: 'ACCOUNTS_HEAD_OR_SUPER_ADMIN' },
        reference: 'EXP-2026-0004 — Client visit',
        requestedById: 'claimant',
        recordId: 'claim-1',
        url: '/expense-claims/claim-1',
      });
      // A departed Accounts Head cannot log in to act, so they are never a
      // recipient — the status filter is part of the query, not an afterthought.
      expect(prisma.employee.findMany).toHaveBeenCalledWith({
        where: {
          status: EmployeeStatus.ACTIVE,
          OR: [{ isAccountsHead: true }, { role: Role.SUPER_ADMIN }],
        },
        select: { id: true },
      });
      expect(push.trySendToEmployees).toHaveBeenCalledWith(
        ['head', 'sa'],
        expect.objectContaining({ tag: 'approval:expense-claim:claim-1' }),
        expect.any(String),
      );
    });

    it('never notifies the actor about their own action', async () => {
      prisma.employee.findMany.mockResolvedValue([
        { id: 'head' },
        { id: 'sa' },
      ]);
      prisma.employee.findUnique.mockResolvedValue(null);
      await service.approvalRequired({
        kind: 'ad-hoc-po',
        audience: { pool: 'SUPER_ADMIN' },
        reference: 'PO-2026-0009 — Local courier',
        recordId: 'po-1',
        url: '/stores/purchase-orders/po-1',
        actorId: 'sa',
      });
      expect(push.trySendToEmployees.mock.calls[0][0]).toEqual(['head']);
    });

    it('de-duplicates and drops empty ids from an explicit audience', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);
      await service.approvalRequired({
        kind: 'bom-release',
        audience: { employeeIds: ['head', 'head', null, undefined, ''] },
        reference: 'Rev 2 — Kiosk frame',
        recordId: 'bom-1',
        url: '/scm/bom/bom-1',
      });
      expect(push.trySendToEmployees.mock.calls[0][0]).toEqual(['head']);
    });

    it('sends nothing, and looks up no name, when the audience is empty', async () => {
      prisma.employee.findMany.mockResolvedValue([{ id: 'only-me' }]);
      await service.approvalRequired({
        kind: 'rfq-pm-approval',
        audience: { pool: 'PROJECT_MANAGER_OR_SUPER_ADMIN' },
        reference: 'RFQ-2026-0003 — Frames',
        requestedById: 'only-me',
        recordId: 'rfq-1',
        url: '/scm/rfqs/rfq-1',
        actorId: 'only-me',
      });
      expect(push.trySendToEmployees).not.toHaveBeenCalled();
      // The requester's name is only worth a query once someone is being told.
      expect(prisma.employee.findUnique).not.toHaveBeenCalled();
    });

    it('falls back to the reference alone when the requester no longer resolves', async () => {
      prisma.employee.findMany.mockResolvedValue([{ id: 'head' }]);
      prisma.employee.findUnique.mockResolvedValue(null);
      await service.approvalRequired({
        kind: 'design-change',
        audience: { pool: 'DESIGN_HEAD' },
        reference: 'ECR-2026-0004 — Swap the latch',
        requestedById: 'deleted-employee',
        recordId: 'change-1',
        url: '/design/changes/change-1',
      });
      expect(push.trySendToEmployees.mock.calls[0][1].body).toBe(
        'ECR-2026-0004 — Swap the latch',
      );
    });
  });

  // ── Nothing escapes ──────────────────────────────────────────────────

  describe('best-effort guarantee', () => {
    it('swallows a failed lookup instead of failing the business action', async () => {
      prisma.employee.findMany.mockRejectedValue(new Error('connection reset'));
      await expect(
        service.approvalRequired({
          kind: 'offer-letter',
          audience: { pool: 'SUPER_ADMIN' },
          reference: 'Jeevan K — Design Engineer',
          recordId: 'offer-1',
          url: '/hr/offer-letters/pending-approval?focus=offer-1',
        }),
      ).resolves.toBeUndefined();
    });

    it('treats a record that has since been deleted as a no-op', async () => {
      prisma.designReview.findUnique.mockResolvedValue(null);
      await expect(
        service.designReviewRejected({ reviewId: 'gone' }),
      ).resolves.toBeUndefined();
      expect(push.trySendToEmployees).not.toHaveBeenCalled();
    });

    it('swallows a delivery failure raised by the push layer itself', async () => {
      prisma.employee.findMany.mockResolvedValue([{ id: 'head' }]);
      prisma.employee.findUnique.mockResolvedValue(null);
      push.trySendToEmployees.mockRejectedValue(new Error('web-push exploded'));
      await expect(
        service.approvalRequired({
          kind: 'bom-release',
          audience: { pool: 'RD_HEAD' },
          reference: 'Rev 2 — Kiosk frame',
          recordId: 'bom-1',
          url: '/scm/bom/bom-1',
        }),
      ).resolves.toBeUndefined();
    });
  });

  // ── Per-event lookups ────────────────────────────────────────────────

  describe('rfqQuoteSubmitted', () => {
    it('notifies the RFQ creator, naming a supplier invitee correctly', async () => {
      prisma.rfqInvitee.findUnique.mockResolvedValue({
        id: 'invitee-1',
        vendor: null,
        supplier: { companyName: 'Bharat Steel' },
        rfq: { id: 'rfq-1', rfqNumber: 'RFQ-2026-0003', createdById: 'scm-1' },
      });
      await service.rfqQuoteSubmitted({
        inviteeId: 'invitee-1',
        isRevision: true,
      });
      expect(push.trySendToEmployee).toHaveBeenCalledWith(
        'scm-1',
        expect.objectContaining({
          title: 'Bharat Steel revised their quote',
          url: '/scm/rfqs/rfq-1',
        }),
        expect.any(String),
      );
    });

    it('still names something when neither partner row resolves', async () => {
      prisma.rfqInvitee.findUnique.mockResolvedValue({
        id: 'invitee-1',
        vendor: null,
        supplier: null,
        rfq: { id: 'rfq-1', rfqNumber: 'RFQ-2026-0003', createdById: 'scm-1' },
      });
      await service.rfqQuoteSubmitted({
        inviteeId: 'invitee-1',
        isRevision: false,
      });
      expect(push.trySendToEmployee.mock.calls[0][1].title).toBe(
        'A vendor submitted a quote',
      );
    });
  });

  describe('designReviewRejected', () => {
    it('notifies the project lead designer with the review type spelled out', async () => {
      prisma.designReview.findUnique.mockResolvedValue({
        id: 'review-1',
        reviewType: 'CRITICAL_DESIGN_REVIEW',
        project: {
          id: 'project-1',
          name: 'Kiosk enclosure',
          leadDesignerId: 'lead-1',
        },
      });
      await service.designReviewRejected({
        reviewId: 'review-1',
        actorId: 'reviewer-1',
      });
      expect(push.trySendToEmployees).toHaveBeenCalledWith(
        ['lead-1'],
        expect.objectContaining({
          body: 'Kiosk enclosure — Critical design review',
        }),
        expect.any(String),
      );
    });

    it('sends nothing when the lead designer recorded the rejection themselves', async () => {
      prisma.designReview.findUnique.mockResolvedValue({
        id: 'review-1',
        reviewType: 'CONCEPT_REVIEW',
        project: {
          id: 'project-1',
          name: 'Kiosk enclosure',
          leadDesignerId: 'lead-1',
        },
      });
      await service.designReviewRejected({
        reviewId: 'review-1',
        actorId: 'lead-1',
      });
      expect(push.trySendToEmployees).not.toHaveBeenCalled();
    });

    it('sends nothing when the project has no lead designer', async () => {
      prisma.designReview.findUnique.mockResolvedValue({
        id: 'review-1',
        reviewType: 'CONCEPT_REVIEW',
        project: { id: 'project-1', name: 'Kiosk', leadDesignerId: null },
      });
      await service.designReviewRejected({ reviewId: 'review-1' });
      expect(push.trySendToEmployees).not.toHaveBeenCalled();
    });
  });

  describe('order dispatch events', () => {
    it('describes a single-product order by its customer-facing name', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        orderNumber: 'ORD-2026-0011',
        ownerId: 'owner-1',
        customer: { name: 'Metro Rail' },
        lineItems: [
          {
            customerFacingProductName: 'Platform Emergency Kiosk',
            adHocProductName: null,
            product: { name: 'PEK-Mk2' },
          },
        ],
      });
      await service.orderReadyToDispatch({
        orderId: 'order-1',
        actorId: 'qc-1',
      });
      expect(push.trySendToEmployees).toHaveBeenCalledWith(
        ['owner-1'],
        expect.objectContaining({
          // The customer-facing override wins over the catalogue name.
          body: 'Platform Emergency Kiosk for Metro Rail. Final QC cleared.',
        }),
        expect.any(String),
      );
    });

    it('describes what the challan actually shipped, not the whole order', async () => {
      prisma.deliveryChallan.findUnique.mockResolvedValue({
        id: 'dc-1',
        dcNumber: 'DC-2026-0004',
        order: { orderNumber: 'ORD-2026-0011', ownerId: 'owner-1' },
        lines: [
          {
            description: 'Mounting bracket, powder coated',
            orderLine: {
              customerFacingProductName: null,
              adHocProductName: null,
              product: { name: 'Bracket' },
            },
          },
        ],
      });
      await service.orderDispatched({ challanId: 'dc-1', actorId: 'store-1' });
      expect(push.trySendToEmployees.mock.calls[0][1].body).toBe(
        'DC-2026-0004 · Bracket',
      );
    });
  });

  describe('plmVendorCadenceBreach', () => {
    it('delivers from the caller-supplied evaluation without re-querying', async () => {
      await service.plmVendorCadenceBreach({
        trackerId: 'tracker-1',
        ownerId: 'owner-1',
        vendorName: 'Ashoka Fabricators',
        orderNumber: 'ORD-2026-0011',
        productName: 'Platform Emergency Kiosk',
        cadenceDays: 1,
      });
      // The sweep already judged this tracker; a second read could describe a
      // different state than the one found to be in breach.
      expect(prisma.employee.findMany).not.toHaveBeenCalled();
      expect(push.trySendToEmployee).toHaveBeenCalledWith(
        'owner-1',
        expect.objectContaining({ tag: 'plm-cadence:tracker-1' }),
        expect.any(String),
      );
    });
  });
});
