import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PurchaseOrderStatus, Role } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PurchaseOrderEmailService } from './purchase-order-email.service';
import { EmailPurchaseOrderDto } from './dto/purchase-order.dto';

/**
 * Emailing an issued PO to the supplier.
 *
 * The properties that matter: only a real order goes out (never a DRAFT or an
 * unapproved ad-hoc exception), the recipient is the partner's registered address
 * unless deliberately overridden, and the "emailed on …" stamp on the detail page
 * is written ONLY for a send the provider actually accepted — a dry-run must not
 * leave a buyer believing the supplier has the order.
 */
describe('PurchaseOrderEmailService.emailToParty', () => {
  const user = {
    id: 'scm-1',
    email: 'scm@example.com',
    role: Role.MANAGER,
    verticalId: 'scm',
  };

  const line = (overrides: Record<string, unknown> = {}) => ({
    id: 'pol-1',
    sequence: 1,
    item: { itemCode: 'RM-0001', name: 'MS Sheet 2mm' },
    adHocItemName: null,
    adHocDescription: null,
    notes: null,
    orderedQuantity: new Prisma.Decimal('212'),
    unitOfMeasure: 'NOS',
    unitPrice: new Prisma.Decimal('500'),
    lineTotal: new Prisma.Decimal('106000'),
    ...overrides,
  });

  const poRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'po-1',
    poNumber: 'PO-2026-0001',
    status: PurchaseOrderStatus.ISSUED,
    supplierId: 'sup-1',
    supplier: {
      companyName: 'Acme Precision Pvt Ltd',
      contactEmail: 'orders@acme.test',
    },
    vendorId: null,
    vendor: null,
    adHocPartyName: null,
    adHocContactInfo: null,
    adHocPartyAddress: null,
    orderDate: new Date('2026-08-22T00:00:00.000Z'),
    expectedDeliveryDate: new Date('2026-09-15T00:00:00.000Z'),
    notes: null,
    createdBy: { firstName: 'SCM', lastName: 'User' },
    lastEmailedAt: null,
    lastEmailedTo: null,
    // The GST column defaults — no tax line on the order.
    gstStateCode: '29',
    gstIgstRate: new Prisma.Decimal(0),
    gstCgstRate: new Prisma.Decimal(0),
    gstSgstRate: new Prisma.Decimal(0),
    lines: [line()],
    ...overrides,
  });

  let prisma: any;
  let access: any;
  let email: any;
  let pdf: any;
  let service: PurchaseOrderEmailService;

  beforeEach(() => {
    prisma = {
      purchaseOrder: {
        findUnique: jest.fn().mockResolvedValue(poRow()),
        update: jest.fn().mockResolvedValue({}),
      },
      financeCompanySettings: {
        findFirst: jest.fn().mockResolvedValue({
          legalName: 'Phaze Dynamics Pvt Ltd',
          gstin: '29ABCDE1234F1Z5',
        }),
      },
    };
    access = { assertCanManagePurchaseOrders: jest.fn() };
    email = {
      send: jest.fn().mockResolvedValue({
        id: 'msg-1',
        recipients: ['orders@acme.test'],
        blocked: [],
      }),
    };
    pdf = {
      htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.7 fake')),
    };
    service = new PurchaseOrderEmailService(prisma, access, email, pdf);
  });

  const run = (dto: Record<string, unknown> = {}) =>
    service.emailToParty('po-1', dto, user as never);

  it("mails the rendered PDF to the partner's registered address", async () => {
    const result = await run();

    expect(access.assertCanManagePurchaseOrders).toHaveBeenCalledWith(user);

    // The document is rendered from the PO, not from anything the caller sent.
    const [html, options] = pdf.htmlToPdf.mock.calls[0];
    expect(html).toContain('PO-2026-0001');
    expect(html).toContain('M/s. Acme Precision Pvt Ltd');
    expect(options.title).toContain('PO-2026-0001');
    expect(options.footerHtml).toContain('class="pageNumber"');

    const sent = email.send.mock.calls[0][0];
    expect(sent.to).toBe('orders@acme.test');
    expect(sent.subject).toBe(
      'Purchase Order PO-2026-0001 from Phaze Dynamics Pvt Ltd',
    );
    expect(sent.tags).toEqual([{ name: 'kind', value: 'purchase-order' }]);
    expect(sent.attachments).toEqual([
      {
        filename: 'PO-2026-0001_Acme-Precision-Pvt-Ltd.pdf',
        content: Buffer.from('%PDF-1.7 fake'),
        contentType: 'application/pdf',
      },
    ]);
    // The body names the attachment, so a stripped one is obvious.
    expect(sent.text).toContain('PO-2026-0001_Acme-Precision-Pvt-Ltd.pdf');
    // A second press is a deliberate re-send, so no idempotency key.
    expect(sent.idempotencyKey).toBeUndefined();

    expect(result).toMatchObject({
      recipients: ['orders@acme.test'],
      blocked: [],
      messageId: 'msg-1',
      skipped: null,
    });
  });

  it('stamps who it went to and when, so the detail page can say so', async () => {
    await run();

    expect(prisma.purchaseOrder.update).toHaveBeenCalledTimes(1);
    const update = prisma.purchaseOrder.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: 'po-1' });
    expect(update.data.lastEmailedTo).toBe('orders@acme.test');
    expect(update.data.lastEmailedAt).toBeInstanceOf(Date);
  });

  it.each(['dry-run', 'suppressed-by-allowlist'])(
    'does not stamp a %s send — nothing reached the supplier',
    async (skipped) => {
      email.send.mockResolvedValue({
        id: null,
        recipients: [],
        blocked: ['orders@acme.test'],
        skipped,
      });

      const result = await run();

      expect(prisma.purchaseOrder.update).not.toHaveBeenCalled();
      // …and the caller is told faithfully, rather than shown "sent".
      expect(result).toMatchObject({ skipped, messageId: null });
    },
  );

  it('reads as a re-send once the order has been mailed before', async () => {
    prisma.purchaseOrder.findUnique.mockResolvedValue(
      poRow({
        lastEmailedAt: new Date('2026-08-25T10:00:00.000Z'),
        lastEmailedTo: 'orders@acme.test',
      }),
    );

    await run();

    const sent = email.send.mock.calls[0][0];
    expect(sent.subject).toContain('(resent)');
    expect(sent.text).toContain('not a new order');
  });

  it('lets a provider failure surface — a silent failure is the worst outcome', async () => {
    // send() (not trySend) precisely because the user pressed a button for this.
    email.send.mockRejectedValue(new Error('The domain is not verified.'));

    await expect(run()).rejects.toThrow('The domain is not verified.');
    expect(prisma.purchaseOrder.update).not.toHaveBeenCalled();
  });

  it('404s an unknown purchase order', async () => {
    prisma.purchaseOrder.findUnique.mockResolvedValue(null);
    await expect(run()).rejects.toThrow(NotFoundException);
    expect(email.send).not.toHaveBeenCalled();
  });

  it('refuses a caller who cannot manage purchase orders', async () => {
    access.assertCanManagePurchaseOrders.mockRejectedValue(
      new ForbiddenException(),
    );
    await expect(run()).rejects.toThrow(ForbiddenException);
    expect(prisma.purchaseOrder.findUnique).not.toHaveBeenCalled();
  });

  describe('status gate', () => {
    const expectRefused = async (status: PurchaseOrderStatus) => {
      prisma.purchaseOrder.findUnique.mockResolvedValue(poRow({ status }));
      await expect(run()).rejects.toThrow(BadRequestException);
      expect(pdf.htmlToPdf).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
    };

    it('refuses a DRAFT — it is not yet an order', () =>
      expectRefused(PurchaseOrderStatus.DRAFT));

    it('refuses an ad-hoc PO awaiting CEO approval', () =>
      // Mailing it would put a commitment in front of a supplier that the
      // business has not made.
      expectRefused(PurchaseOrderStatus.PENDING_CEO_APPROVAL));

    it('refuses a REJECTED or CANCELLED order', async () => {
      await expectRefused(PurchaseOrderStatus.REJECTED);
      await expectRefused(PurchaseOrderStatus.CANCELLED);
    });

    it.each([
      PurchaseOrderStatus.ISSUED,
      PurchaseOrderStatus.PARTIALLY_RECEIVED,
      PurchaseOrderStatus.FULLY_RECEIVED,
    ])('allows a re-send while the order is %s', async (status) => {
      // A part-received order is still live: the supplier may need the copy again.
      prisma.purchaseOrder.findUnique.mockResolvedValue(poRow({ status }));
      await expect(run()).resolves.toBeDefined();
    });
  });

  describe('recipient resolution', () => {
    it('prefers an explicit override over the address on record', async () => {
      await run({ to: '  purchase@acme.test ' });
      expect(email.send.mock.calls[0][0].to).toBe('purchase@acme.test');
      expect(
        prisma.purchaseOrder.update.mock.calls[0][0].data.lastEmailedTo,
      ).toBe('purchase@acme.test');
    });

    it('rejects an override that is not an address', async () => {
      await expect(run({ to: 'not-an-email' })).rejects.toThrow(
        /not a valid email address/,
      );
      expect(email.send).not.toHaveBeenCalled();
    });

    it("falls back to a vendor's contact email", async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue(
        poRow({
          supplierId: null,
          supplier: null,
          vendorId: 'ven-1',
          vendor: {
            companyName: 'Bharat Fabrication',
            contactEmail: 'sales@bharat.test',
          },
        }),
      );

      await run();

      expect(email.send.mock.calls[0][0].to).toBe('sales@bharat.test');
      expect(email.send.mock.calls[0][0].attachments[0].filename).toBe(
        'PO-2026-0001_Bharat-Fabrication.pdf',
      );
    });

    it('asks for an address on an ad-hoc party rather than guessing one', async () => {
      // adHocContactInfo is free-text prose; mining an address out of it and
      // mailing an order there is not a guess worth making.
      prisma.purchaseOrder.findUnique.mockResolvedValue(
        poRow({
          supplierId: null,
          supplier: null,
          adHocPartyName: 'One-off Fabricator',
          adHocContactInfo: 'Ravi — call 90000 00000, ravi@oneoff.test',
        }),
      );

      await expect(run()).rejects.toThrow(
        /ad-hoc party has no registered email/,
      );
      expect(email.send).not.toHaveBeenCalled();

      // …and sends once the buyer supplies one.
      await run({ to: 'ravi@oneoff.test' });
      expect(email.send.mock.calls[0][0].to).toBe('ravi@oneoff.test');
    });

    it('reports a partner with a blank or malformed address on record', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue(
        poRow({
          supplier: {
            companyName: 'Acme Precision Pvt Ltd',
            contactEmail: '  ',
          },
        }),
      );
      await expect(run()).rejects.toThrow(/no contact email on record/);

      prisma.purchaseOrder.findUnique.mockResolvedValue(
        poRow({
          supplier: {
            companyName: 'Acme Precision Pvt Ltd',
            contactEmail: 'acme.test',
          },
        }),
      );
      await expect(run()).rejects.toThrow(/is not a valid address/);
    });
  });

  it('falls back to the default organisation name on an unseeded DB', async () => {
    prisma.financeCompanySettings.findFirst.mockResolvedValue(null);

    await run();

    expect(email.send.mock.calls[0][0].subject).toContain('Phaze Dynamics');
    // No GST registration on record simply means the label is omitted.
    expect(pdf.htmlToPdf.mock.calls[0][0]).not.toContain('GSTIN:');
  });

  it('totals the lines itself rather than trusting a stored figure', async () => {
    prisma.purchaseOrder.findUnique.mockResolvedValue(
      poRow({
        lines: [
          line(),
          line({
            id: 'pol-2',
            sequence: 2,
            item: null,
            adHocItemName: 'Powder coating',
            lineTotal: new Prisma.Decimal('31000'),
          }),
        ],
      }),
    );

    await run();

    expect(pdf.htmlToPdf.mock.calls[0][0]).toContain('1,37,000.00');
    expect(email.send.mock.calls[0][0].text).toContain('INR 1,37,000.00');
    expect(email.send.mock.calls[0][0].text).toContain('2 line items');
  });
});

describe('EmailPurchaseOrderDto', () => {
  const check = (payload: Record<string, unknown>) =>
    validate(plainToInstance(EmailPurchaseOrderDto, payload), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

  it('accepts an empty body — the partner address is the default', async () => {
    expect(await check({})).toHaveLength(0);
  });

  it('accepts a recipient override and a note', async () => {
    expect(
      await check({ to: 'orders@acme.test', note: 'Freight to our account.' }),
    ).toHaveLength(0);
  });

  it('rejects a malformed address at the edge', async () => {
    const errors = await check({ to: 'orders@' });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('to');
  });

  it('rejects unknown fields', async () => {
    // Notably nothing may override the attachment or the subject line.
    expect(await check({ subject: 'Anything you like' })).toHaveLength(1);
  });
});
