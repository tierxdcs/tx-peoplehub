import {
  approvalRequiredPush,
  cardAssignedPush,
  cardCommentedPush,
  describeProducts,
  designReviewRejectedPush,
  orderDispatchedPush,
  orderReadyToDispatchPush,
  pingReceivedPush,
  PINGS_URL,
  plmVendorCadenceBreachPush,
  PUSH_PREVIEW_LENGTH,
  rfqQuoteSubmittedPush,
} from './push-triggers';

describe('push triggers', () => {
  describe('pingReceivedPush', () => {
    it('names the sender and previews the message', () => {
      const push = pingReceivedPush({
        pingId: 'ping-1',
        senderName: 'Asha Menon',
        message: 'Can you approve the GRN before 5?',
      });
      expect(push.title).toBe('Asha Menon pinged you');
      expect(push.body).toBe('Can you approve the GRN before 5?');
    });

    it('deep-links to the Pings view', () => {
      expect(
        pingReceivedPush({
          pingId: 'ping-1',
          senderName: 'Asha',
          message: 'hi',
        }).url,
      ).toBe(PINGS_URL);
    });

    it('tags per ping so two different pings do not collapse into one', () => {
      const a = pingReceivedPush({
        pingId: 'ping-1',
        senderName: 'Asha',
        message: 'first',
      });
      const b = pingReceivedPush({
        pingId: 'ping-2',
        senderName: 'Asha',
        message: 'second',
      });
      expect(a.tag).toBe('ping:ping-1');
      expect(b.tag).toBe('ping:ping-2');
      expect(a.tag).not.toBe(b.tag);
    });

    it('truncates a long message rather than filling the notification shade', () => {
      const push = pingReceivedPush({
        pingId: 'ping-1',
        senderName: 'Asha',
        message: 'x'.repeat(500),
      });
      expect(push.body).toHaveLength(PUSH_PREVIEW_LENGTH);
      expect(push.body?.endsWith('…')).toBe(true);
    });
  });

  describe('cardAssignedPush', () => {
    it('names the assigner and shows the task title', () => {
      const push = cardAssignedPush({
        cardId: 'card-7',
        cardTitle: 'Draft the Q3 vendor audit plan',
        assignerName: 'Ravi Kumar',
      });
      expect(push.title).toBe('Ravi Kumar assigned you a task');
      expect(push.body).toBe('Draft the Q3 vendor audit plan');
    });

    it('deep-links through the card resolver, not straight to a board', () => {
      // /kanban/cards/:id is what decides board-modal vs standalone view, so a
      // non-member assignee is never sent to a board they cannot open.
      expect(
        cardAssignedPush({
          cardId: 'card-7',
          cardTitle: 'Task',
          assignerName: 'Ravi',
        }).url,
      ).toBe('/kanban/cards/card-7');
    });

    it('tags per card so a reassignment replaces the earlier notification', () => {
      expect(
        cardAssignedPush({
          cardId: 'card-7',
          cardTitle: 'Task',
          assignerName: 'Ravi',
        }).tag,
      ).toBe('card:card-7');
    });
  });

  describe('cardCommentedPush', () => {
    const base = {
      cardId: 'card-7',
      cardTitle: 'Draft the Q3 vendor audit plan',
      commenterName: 'Asha Menon',
      comment: 'Can you confirm the shortlist?',
    } as const;

    it('names the commenter, the card and what they said', () => {
      const push = cardCommentedPush(base);
      expect(push.title).toBe('Asha Menon commented on your card');
      // Both, because the title alone would make the creator open the app just to
      // find out whether the comment needs them.
      expect(push.body).toBe(
        'Draft the Q3 vendor audit plan — Can you confirm the shortlist?',
      );
      expect(push.url).toBe('/kanban/cards/card-7');
    });

    it('tags per card, so a back-and-forth is one notification not five', () => {
      const a = cardCommentedPush(base);
      const b = cardCommentedPush({ ...base, comment: 'and another thing' });
      expect(a.tag).toBe('card-comment:card-7');
      expect(a.tag).toBe(b.tag);
      // Distinct from the assignment tag on the same card: being assigned and
      // being commented on are two different things to act on.
      expect(a.tag).not.toBe(
        cardAssignedPush({ ...base, assignerName: 'Asha' }).tag,
      );
    });

    it('truncates a long comment rather than filling the notification shade', () => {
      const push = cardCommentedPush({ ...base, comment: 'x'.repeat(500) });
      expect(push.body).toHaveLength(PUSH_PREVIEW_LENGTH);
      expect(push.body?.endsWith('…')).toBe(true);
    });
  });

  describe('approvalRequiredPush', () => {
    const base = {
      reference: 'REQ-2026-0007 — Design Engineer',
      recordId: 'req-7',
      url: '/hr/candidate-requisitions?focus=req-7',
    } as const;

    it('names the gate in the approver’s own words and says who asked', () => {
      const push = approvalRequiredPush({
        ...base,
        kind: 'candidate-requisition',
        requestedBy: 'Nithin Raj',
      });
      expect(push.title).toBe('Candidate requisition needs your approval');
      expect(push.body).toBe(
        'REQ-2026-0007 — Design Engineer — from Nithin Raj',
      );
      expect(push.url).toBe(base.url);
    });

    it('still says what is waiting when there is no named requester', () => {
      // Two gates have no single human requester, so a missing name must degrade
      // to the reference rather than "from undefined".
      const push = approvalRequiredPush({ ...base, kind: 'rfq-pm-approval' });
      expect(push.title).toBe('RFQ needs your approval');
      expect(push.body).toBe('REQ-2026-0007 — Design Engineer');
      expect(
        approvalRequiredPush({
          ...base,
          kind: 'rfq-pm-approval',
          requestedBy: '  ',
        }).body,
      ).toBe('REQ-2026-0007 — Design Engineer');
    });

    it('uses the product label, not the model name, for an ECR', () => {
      expect(
        approvalRequiredPush({ ...base, kind: 'design-change' }).title,
      ).toBe('Engineering change request needs your approval');
    });

    it('tags per gate AND record, so a resubmission replaces but two records do not', () => {
      const a = approvalRequiredPush({ ...base, kind: 'expense-claim' });
      const b = approvalRequiredPush({
        ...base,
        kind: 'expense-claim',
        recordId: 'claim-9',
      });
      const other = approvalRequiredPush({ ...base, kind: 'bom-release' });
      expect(a.tag).toBe('approval:expense-claim:req-7');
      expect(a.tag).not.toBe(b.tag);
      expect(a.tag).not.toBe(other.tag);
    });
  });

  describe('rfqQuoteSubmittedPush', () => {
    const base = {
      rfqId: 'rfq-1',
      rfqNumber: 'RFQ-2026-0003',
      inviteeId: 'invitee-1',
      vendorName: 'Ashoka Fabricators',
    } as const;

    it('distinguishes a first quote from a negotiated revision', () => {
      expect(rfqQuoteSubmittedPush({ ...base, isRevision: false }).title).toBe(
        'Ashoka Fabricators submitted a quote',
      );
      expect(rfqQuoteSubmittedPush({ ...base, isRevision: true }).title).toBe(
        'Ashoka Fabricators revised their quote',
      );
    });

    it('deep-links to the RFQ and tags per invitee, not per RFQ', () => {
      // Three vendors quoting one RFQ are three things to look at — collapsing
      // them onto an rfq-keyed tag would hide two of the three.
      const a = rfqQuoteSubmittedPush({ ...base, isRevision: false });
      const b = rfqQuoteSubmittedPush({
        ...base,
        inviteeId: 'invitee-2',
        isRevision: false,
      });
      expect(a.url).toBe('/scm/rfqs/rfq-1');
      expect(a.tag).toBe('rfq-quote:invitee-1');
      expect(a.tag).not.toBe(b.tag);
    });
  });

  describe('plmVendorCadenceBreachPush', () => {
    const base = {
      trackerId: 'tracker-1',
      vendorName: 'Ashoka Fabricators',
      orderNumber: 'ORD-2026-0011',
      productName: 'Platform Emergency Kiosk',
    } as const;

    it('names the vendor, the order and the product the owner has to chase', () => {
      const push = plmVendorCadenceBreachPush({ ...base, cadenceDays: 2 });
      expect(push.title).toBe('Vendor update overdue — Ashoka Fabricators');
      expect(push.body).toBe(
        'ORD-2026-0011 — Platform Emergency Kiosk. Updates are due every 2 days.',
      );
      expect(push.url).toBe('/plm/trackers/tracker-1');
    });

    it('reads a one-day cadence as "daily", not "every 1 days"', () => {
      expect(
        plmVendorCadenceBreachPush({ ...base, cadenceDays: 1 }).body,
      ).toContain('due daily');
    });

    it('tags per tracker so a daily sweep replaces rather than piles up', () => {
      expect(plmVendorCadenceBreachPush({ ...base, cadenceDays: 1 }).tag).toBe(
        'plm-cadence:tracker-1',
      );
    });
  });

  describe('designReviewRejectedPush', () => {
    it('names the project and the review, and focuses the project row', () => {
      const push = designReviewRejectedPush({
        reviewId: 'review-1',
        projectId: 'project 1',
        projectName: 'Kiosk enclosure',
        reviewLabel: 'Critical design review',
      });
      expect(push.title).toBe('Design review rejected');
      expect(push.body).toBe('Kiosk enclosure — Critical design review');
      // Design projects have no detail route, so the deep link focuses the row on
      // the list page — and the id is encoded, not concatenated raw.
      expect(push.url).toBe('/design/projects?focus=project%201');
      expect(push.tag).toBe('design-review:review-1');
    });
  });

  describe('describeProducts', () => {
    it('names a single product, counts several, and collapses duplicates', () => {
      expect(describeProducts(['Kiosk'])).toBe('Kiosk');
      expect(describeProducts(['Kiosk', 'Bracket', 'Harness'])).toBe(
        '3 products',
      );
      // Three lines of the same product is still one product.
      expect(describeProducts(['Kiosk', 'Kiosk', 'Kiosk'])).toBe('Kiosk');
    });

    it('returns null when nothing is nameable, rather than "0 products"', () => {
      expect(describeProducts([])).toBeNull();
      expect(describeProducts([null, undefined, '   '])).toBeNull();
    });
  });

  describe('order dispatch pushes', () => {
    it('says what is shippable, for whom, and links the order', () => {
      const push = orderReadyToDispatchPush({
        orderId: 'order-1',
        orderNumber: 'ORD-2026-0011',
        customerName: 'Metro Rail',
        productSummary: 'Platform Emergency Kiosk',
      });
      expect(push.title).toBe('Ready to dispatch — ORD-2026-0011');
      expect(push.body).toBe(
        'Platform Emergency Kiosk for Metro Rail. Final QC cleared.',
      );
      expect(push.url).toBe('/sales/orders/order-1');
      expect(push.tag).toBe('order-dispatch-ready:order-1');
    });

    it('still reads as a sentence with no customer and no product on record', () => {
      expect(
        orderReadyToDispatchPush({
          orderId: 'order-1',
          orderNumber: 'ORD-2026-0011',
          customerName: null,
          productSummary: null,
        }).body,
      ).toBe('The order. Final QC cleared.');
    });

    it('opens the challan that just became real, tagged per challan', () => {
      // Three part-shipments are three events, so three notifications — the tag
      // is the challan, never the order.
      const a = orderDispatchedPush({
        challanId: 'dc-1',
        dcNumber: 'DC-2026-0004',
        orderNumber: 'ORD-2026-0011',
        productSummary: '2 products',
      });
      const b = orderDispatchedPush({
        challanId: 'dc-2',
        dcNumber: 'DC-2026-0005',
        orderNumber: 'ORD-2026-0011',
        productSummary: 'Bracket',
      });
      expect(a.title).toBe('Dispatched — ORD-2026-0011');
      expect(a.body).toBe('DC-2026-0004 · 2 products');
      expect(a.url).toBe('/logistics/dispatch/dc-1');
      expect(a.tag).not.toBe(b.tag);
    });
  });
});
