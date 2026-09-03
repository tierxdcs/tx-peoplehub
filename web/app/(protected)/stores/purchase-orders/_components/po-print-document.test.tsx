import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PurchaseOrderPrintDocument } from './po-print-document';
import type {
  PurchaseOrder,
  PurchaseOrderAdvance,
} from '../../../../lib/stores';

/**
 * The browser-print twin of the server-rendered PDF
 * (src/modules/scm-purchasing/purchase-order-document.ts). What matters here is
 * the advance: it is a commercial term the party is being asked to agree to, so
 * a PO that carries one must print it, and a PO that does not must not imply one.
 */
function po(advance: PurchaseOrderAdvance | null): PurchaseOrder {
  return {
    id: 'po-1',
    poNumber: 'PO-2026-0001',
    status: 'ISSUED',
    supplierId: 'sup-1',
    supplierName: 'Acme Precision Pvt Ltd',
    vendorId: null,
    vendorName: null,
    adHocPartyName: null,
    adHocContactInfo: null,
    adHocPartyAddress: null,
    ceoApprovedById: null,
    ceoApprovedAt: null,
    rejectedById: null,
    rejectedAt: null,
    rejectionComment: null,
    orderDate: '2026-08-22T00:00:00.000Z',
    expectedDeliveryDate: null,
    notes: null,
    createdById: 'scm-1',
    createdByName: 'SCM User',
    issuedAt: '2026-09-02T00:00:00.000Z',
    cancelledAt: null,
    lastEmailedAt: null,
    lastEmailedTo: null,
    partyEmail: null,
    totalAmount: '137000.00',
    approvalAmount: '137000.00',
    advance,
    approvals: [],
    lines: [
      {
        id: 'pol-1',
        itemId: null,
        itemCode: 'RM-0001',
        itemName: 'MS Sheet 2mm',
        adHocDescription: null,
        orderedQuantity: '212',
        unitPrice: '500',
        unitOfMeasure: 'NOS',
        lineTotal: '137000.00',
        notes: null,
        sequence: 0,
      },
    ],
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
  };
}

const advance: PurchaseOrderAdvance = {
  percent: '30.00',
  amount: '41100.00',
  indicativeAmount: null,
  paymentId: 'pay-1',
  paymentNumber: 'PAY-2026-00001',
  status: 'DRAFT',
  plannedDate: '2026-09-02T00:00:00.000Z',
  executedDate: null,
  bankReference: null,
  rejectionComment: null,
};

describe('PurchaseOrderPrintDocument advance terms', () => {
  it('prints the advance as a payment term with its rupee value', () => {
    const { container } = render(
      <PurchaseOrderPrintDocument po={po(advance)} generatedOn="2026-09-02" />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('Payment terms');
    expect(text).toContain('30.00%');
    expect(text).toContain('41,100.00');
    expect(text).toContain('before delivery');
  });

  it('falls back to the indicative value before the PO is issued', () => {
    const { container } = render(
      <PurchaseOrderPrintDocument
        po={po({ ...advance, amount: null, indicativeAmount: '41100.00' })}
        generatedOn="2026-09-02"
      />,
    );
    expect(container.textContent).toContain('41,100.00');
  });

  it('says nothing about payment terms when there is no advance', () => {
    const { container } = render(
      <PurchaseOrderPrintDocument po={po(null)} generatedOn="2026-09-02" />,
    );
    expect(container.textContent).not.toContain('Payment terms');
  });
});
