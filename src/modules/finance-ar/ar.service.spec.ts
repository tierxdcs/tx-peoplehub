import { BadRequestException } from '@nestjs/common';
import { GstDocumentType, SalesInvoiceStatus } from '@prisma/client';
import { ArService } from './ar.service';

describe('ArService invoice calculations', () => {
  const service = new ArService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const calculate = (line: Record<string, unknown>) =>
    (service as any).calculateLine(line, 0);

  it('calculates discounted taxable value and IGST using Decimal arithmetic', () => {
    const line = calculate({
      description: 'Machine',
      hsnSacCode: '8479',
      quantity: 2,
      unitOfMeasure: 'NOS',
      unitPrice: 1000,
      discountPercent: 10,
      igstRate: 18,
    });
    expect(line.taxableAmount.toString()).toBe('1800');
    expect(line.igstAmount.toString()).toBe('324');
    expect(line.lineTotal.toString()).toBe('2124');
  });

  it('calculates equal CGST and SGST for intra-state supply', () => {
    const line = calculate({
      description: 'Service',
      hsnSacCode: '9983',
      quantity: 1,
      unitOfMeasure: 'EA',
      unitPrice: 1000,
      cgstRate: 9,
      sgstRate: 9,
    });
    expect(line.cgstAmount.toString()).toBe('90');
    expect(line.sgstAmount.toString()).toBe('90');
    expect(line.lineTotal.toString()).toBe('1180');
  });

  it('rejects simultaneous IGST and CGST/SGST', () => {
    expect(() =>
      calculate({
        description: 'Invalid',
        hsnSacCode: '1',
        quantity: 1,
        unitOfMeasure: 'EA',
        unitPrice: 100,
        igstRate: 18,
        cgstRate: 9,
        sgstRate: 9,
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects unequal CGST and SGST rates', () => {
    expect(() =>
      calculate({
        description: 'Invalid',
        hsnSacCode: '1',
        quantity: 1,
        unitOfMeasure: 'EA',
        unitPrice: 100,
        cgstRate: 9,
        sgstRate: 8,
      }),
    ).toThrow(BadRequestException);
  });

  describe('manual IRN entry', () => {
    const dto = {
      irn: 'a'.repeat(64),
      acknowledgementNumber: 'ACK-123',
      acknowledgementDate: '2026-08-25T12:30:00.000Z',
      signedQrCode: 'signed-qr-payload',
    };
    const user = { id: 'finance-head' } as any;

    function manualService(
      status: SalesInvoiceStatus = SalesInvoiceStatus.GST_PENDING,
    ) {
      const prisma = {
        salesInvoice: {
          findFirst: jest.fn().mockResolvedValue(null),
          update: jest.fn().mockResolvedValue({}),
        },
        gstSubmission: { update: jest.fn().mockResolvedValue({}) },
        $transaction: jest.fn().mockResolvedValue([]),
      };
      const access = {
        assertAccountsHead: jest.fn().mockResolvedValue(undefined),
      };
      const current = new ArService(
        prisma as any,
        access as any,
        {} as any,
        {} as any,
        {} as any,
      );
      jest.spyOn(current as any, 'findInvoice').mockResolvedValue({
        id: 'invoice-1',
        status,
        gstSubmissions: [
          { id: 'submission-1', documentType: GstDocumentType.TAX_INVOICE },
        ],
      });
      jest.spyOn(current as any, 'issueAndPost').mockResolvedValue({
        id: 'invoice-1',
        status: SalesInvoiceStatus.E_INVOICE_GENERATED,
      });
      return { current, prisma, access };
    }

    it('records the IRP response and issues the invoice with the generated status', async () => {
      const { current, prisma, access } = manualService();

      await expect(
        current.recordManualIrn('invoice-1', dto, user),
      ).resolves.toMatchObject({
        status: SalesInvoiceStatus.E_INVOICE_GENERATED,
      });

      expect(access.assertAccountsHead).toHaveBeenCalledWith(user);
      expect(prisma.gstSubmission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'submission-1' },
          data: expect.objectContaining({
            status: 'SUCCEEDED',
            responsePayload: expect.objectContaining({
              source: 'MANUAL_IRP_ENTRY',
            }),
          }),
        }),
      );
      expect(prisma.salesInvoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            irn: dto.irn,
            irnAcknowledgementNumber: dto.acknowledgementNumber,
            signedQrCode: dto.signedQrCode,
          }),
        }),
      );
    });

    it('rejects manual IRN entry for an invoice that is not GST pending', async () => {
      const { current, prisma } = manualService(SalesInvoiceStatus.ISSUED);

      await expect(
        current.recordManualIrn('invoice-1', dto, user),
      ).rejects.toThrow(
        'Manual IRN entry is only available for GST-pending invoices',
      );
      expect(prisma.salesInvoice.update).not.toHaveBeenCalled();
    });
  });

  describe('createInvoice place-of-supply guard', () => {
    const user = { id: 'accounts-1' } as any;
    const dto = {
      customerId: 'customer-1',
      invoiceDate: '2026-09-02',
      dueDate: '2026-10-02',
      currencyCode: 'INR',
      placeOfSupplyState: 'Karnataka',
      placeOfSupplyStateCode: '29',
      lines: [
        {
          description: 'Kiosk',
          hsnSacCode: '8479',
          quantity: 1,
          unitOfMeasure: 'NOS',
          unitPrice: 1000,
          cgstRate: 9,
          sgstRate: 9,
        },
      ],
    } as any;

    function createService() {
      const prisma = {
        customer: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ id: 'customer-1', billingAddress: {} }),
        },
        $transaction: jest.fn(),
      };
      // Only the invoice row matters here; the transaction body is otherwise
      // just numbering + a single create.
      const create = jest.fn().mockResolvedValue({ id: 'inv-1' });
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({ salesInvoice: { create } }),
      );
      const current = new ArService(
        prisma as any,
        {
          assertCanUseFinance: jest.fn().mockResolvedValue(undefined),
        } as any,
        {} as any,
        { nextNumber: jest.fn().mockResolvedValue('INV-2026-0018') } as any,
        {} as any,
      );
      return { current, prisma, create };
    }

    it('rejects a state name that does not belong to the code', async () => {
      const { current, prisma } = createService();

      await expect(
        current.createInvoice(
          { ...dto, placeOfSupplyState: 'Tamil Nadu' },
          user,
        ),
      ).rejects.toThrow(/is not the GST state for code 29/);
      // Refused before any numbering is consumed or row written.
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a code GSTN has retired', async () => {
      const { current, prisma } = createService();

      await expect(
        current.createInvoice(
          {
            ...dto,
            placeOfSupplyState: 'Daman and Diu',
            placeOfSupplyStateCode: '25',
          },
          user,
        ),
      ).rejects.toThrow(/place of supply/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('accepts a matching pair and stores GSTN’s own spelling', async () => {
      const { current, create } = createService();

      await expect(
        current.createInvoice(
          { ...dto, placeOfSupplyState: '  karnataka  ' },
          user,
        ),
      ).resolves.toEqual({ id: 'inv-1' });

      // Whatever case the caller sent, the invoice prints "Karnataka".
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            placeOfSupplyState: 'Karnataka',
            placeOfSupplyStateCode: '29',
          }),
        }),
      );
    });
  });

  describe('deleteInvoice — pre-issuance only', () => {
    const user = { id: 'accounts-1' } as any;

    function deleteService(invoice: Record<string, unknown> | null) {
      const prisma = {
        salesInvoice: {
          findUnique: jest.fn().mockResolvedValue(
            invoice && {
              id: 'invoice-1',
              invoiceNumber: 'INV-2026-0016',
              irn: null,
              journalEntryId: null,
              deliveryChallan: null,
              _count: { allocations: 0, adjustmentNotes: 0 },
              ...invoice,
            },
          ),
          delete: jest.fn().mockResolvedValue({}),
        },
      };
      const access = {
        assertCanUseFinance: jest.fn().mockResolvedValue(undefined),
      };
      const current = new ArService(
        prisma as any,
        access as any,
        {} as any,
        {} as any,
        {} as any,
      );
      return { current, prisma, access };
    }

    it.each([
      SalesInvoiceStatus.DRAFT,
      SalesInvoiceStatus.PENDING_APPROVAL,
      SalesInvoiceStatus.REJECTED,
      SalesInvoiceStatus.GST_PENDING,
      SalesInvoiceStatus.CANCELLED,
    ])('deletes a %s invoice', async (status) => {
      const { current, prisma, access } = deleteService({ status });

      await expect(current.deleteInvoice('invoice-1', user)).resolves.toEqual({
        id: 'invoice-1',
        invoiceNumber: 'INV-2026-0016',
        unlinkedChallanNumber: null,
      });
      // Accounts-vertical users and SUPER_ADMIN, not just the Accounts Head.
      expect(access.assertCanUseFinance).toHaveBeenCalledWith(user);
      expect(prisma.salesInvoice.delete).toHaveBeenCalledWith({
        where: { id: 'invoice-1' },
      });
    });

    it.each([
      SalesInvoiceStatus.ISSUED,
      SalesInvoiceStatus.E_INVOICE_GENERATED,
      SalesInvoiceStatus.PARTIALLY_PAID,
      SalesInvoiceStatus.PAID,
      SalesInvoiceStatus.OVERDUE,
    ])('refuses to delete a %s invoice', async (status) => {
      const { current, prisma } = deleteService({ status });

      await expect(current.deleteInvoice('invoice-1', user)).rejects.toThrow(
        /cannot be deleted/,
      );
      expect(prisma.salesInvoice.delete).not.toHaveBeenCalled();
    });

    it('names the delivery challan that loses its invoice link', async () => {
      const { current } = deleteService({
        status: SalesInvoiceStatus.DRAFT,
        deliveryChallan: { dcNumber: 'DC-2026-0007' },
      });

      await expect(current.deleteInvoice('invoice-1', user)).resolves.toEqual(
        expect.objectContaining({ unlinkedChallanNumber: 'DC-2026-0007' }),
      );
    });

    it('reports a missing invoice rather than silently succeeding', async () => {
      const { current, prisma } = deleteService(null);

      await expect(current.deleteInvoice('invoice-1', user)).rejects.toThrow(
        'Sales invoice not found',
      );
      expect(prisma.salesInvoice.delete).not.toHaveBeenCalled();
    });

    // The status list is the friendly gate; these are the real invariant. A
    // deletable status carrying any of them means the invoice is in the books.
    it.each([
      [{ journalEntryId: 'je-1' }, /posted to the general ledger/],
      [{ irn: 'a'.repeat(64) }, /registered on the GST portal/],
      [
        { _count: { allocations: 1, adjustmentNotes: 0 } },
        /receipt is allocated/,
      ],
      [
        { _count: { allocations: 0, adjustmentNotes: 1 } },
        /credit or debit note references/,
      ],
    ])('refuses a DRAFT invoice with %j', async (overrides, message) => {
      const { current, prisma } = deleteService({
        status: SalesInvoiceStatus.DRAFT,
        ...overrides,
      });

      await expect(current.deleteInvoice('invoice-1', user)).rejects.toThrow(
        message,
      );
      expect(prisma.salesInvoice.delete).not.toHaveBeenCalled();
    });
  });
});
