import { BadRequestException } from '@nestjs/common';
import {
  GstDocumentType,
  SalesInvoiceStatus,
} from '@prisma/client';
import { ArService } from './ar.service';

describe('ArService invoice calculations', () => {
  const service = new ArService({} as any, {} as any, {} as any, {} as any, {} as any);
  const calculate = (line: Record<string, unknown>) =>
    (service as any).calculateLine(line, 0);

  it('calculates discounted taxable value and IGST using Decimal arithmetic', () => {
    const line = calculate({
      description: 'Machine', hsnSacCode: '8479', quantity: 2,
      unitOfMeasure: 'NOS', unitPrice: 1000, discountPercent: 10,
      igstRate: 18,
    });
    expect(line.taxableAmount.toString()).toBe('1800');
    expect(line.igstAmount.toString()).toBe('324');
    expect(line.lineTotal.toString()).toBe('2124');
  });

  it('calculates equal CGST and SGST for intra-state supply', () => {
    const line = calculate({
      description: 'Service', hsnSacCode: '9983', quantity: 1,
      unitOfMeasure: 'EA', unitPrice: 1000, cgstRate: 9, sgstRate: 9,
    });
    expect(line.cgstAmount.toString()).toBe('90');
    expect(line.sgstAmount.toString()).toBe('90');
    expect(line.lineTotal.toString()).toBe('1180');
  });

  it('rejects simultaneous IGST and CGST/SGST', () => {
    expect(() => calculate({
      description: 'Invalid', hsnSacCode: '1', quantity: 1,
      unitOfMeasure: 'EA', unitPrice: 100, igstRate: 18,
      cgstRate: 9, sgstRate: 9,
    })).toThrow(BadRequestException);
  });

  it('rejects unequal CGST and SGST rates', () => {
    expect(() => calculate({
      description: 'Invalid', hsnSacCode: '1', quantity: 1,
      unitOfMeasure: 'EA', unitPrice: 100, cgstRate: 9, sgstRate: 8,
    })).toThrow(BadRequestException);
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
      const access = { assertAccountsHead: jest.fn().mockResolvedValue(undefined) };
      const current = new ArService(prisma as any, access as any, {} as any, {} as any, {} as any);
      jest.spyOn(current as any, 'findInvoice').mockResolvedValue({
        id: 'invoice-1',
        status,
        gstSubmissions: [{ id: 'submission-1', documentType: GstDocumentType.TAX_INVOICE }],
      });
      jest.spyOn(current as any, 'issueAndPost').mockResolvedValue({
        id: 'invoice-1',
        status: SalesInvoiceStatus.E_INVOICE_GENERATED,
      });
      return { current, prisma, access };
    }

    it('records the IRP response and issues the invoice with the generated status', async () => {
      const { current, prisma, access } = manualService();

      await expect(current.recordManualIrn('invoice-1', dto, user)).resolves.toMatchObject({
        status: SalesInvoiceStatus.E_INVOICE_GENERATED,
      });

      expect(access.assertAccountsHead).toHaveBeenCalledWith(user);
      expect(prisma.gstSubmission.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'submission-1' },
        data: expect.objectContaining({
          status: 'SUCCEEDED',
          responsePayload: expect.objectContaining({ source: 'MANUAL_IRP_ENTRY' }),
        }),
      }));
      expect(prisma.salesInvoice.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          irn: dto.irn,
          irnAcknowledgementNumber: dto.acknowledgementNumber,
          signedQrCode: dto.signedQrCode,
        }),
      }));
    });

    it('rejects manual IRN entry for an invoice that is not GST pending', async () => {
      const { current, prisma } = manualService(SalesInvoiceStatus.ISSUED);

      await expect(current.recordManualIrn('invoice-1', dto, user)).rejects.toThrow(
        'Manual IRN entry is only available for GST-pending invoices',
      );
      expect(prisma.salesInvoice.update).not.toHaveBeenCalled();
    });
  });
});
