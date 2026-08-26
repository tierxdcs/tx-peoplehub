import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { renderRfqQuotePdf, rfqQuoteFileName } from './rfq-quote-pdf';
import {
  RFQ_QUOTES_FOLDER_NAME,
  RfqQuoteVaultService,
} from './rfq-quote-vault.service';

const D = (value: string | number) => new Prisma.Decimal(value);

describe('rfqQuoteFileName', () => {
  it('puts the RFQ number first and the partner second, with no date', () => {
    expect(rfqQuoteFileName('RFQ-2026-0007', 'Vigyanlabs Innovations')).toBe(
      'RFQ-2026-0007_Vigyanlabs-Innovations_Quote.pdf',
    );
  });

  it('collapses punctuation in a partner name to single hyphens', () => {
    expect(rfqQuoteFileName('RFQ-2026-0007', 'Dhanur Teck  Pvt. Ltd.')).toBe(
      'RFQ-2026-0007_Dhanur-Teck-Pvt-Ltd_Quote.pdf',
    );
  });

  it('never leaves the partner segment empty', () => {
    expect(rfqQuoteFileName('RFQ-2026-0007', '株式会社')).toBe(
      'RFQ-2026-0007_Unnamed_Quote.pdf',
    );
  });
});

describe('renderRfqQuotePdf', () => {
  it('produces a PDF buffer', async () => {
    const bytes = await renderRfqQuotePdf({
      rfqNumber: 'RFQ-2026-0007',
      submissionDeadline: new Date('2026-09-01T00:00:00.000Z'),
      requiredByDate: new Date('2026-10-15T00:00:00.000Z'),
      deliveryLocation: 'Bengaluru plant',
      paymentTermsRequested: '30 days',
      partnerKind: 'Vendor',
      partnerName: 'Vigyanlabs Innovations',
      submittedAt: new Date('2026-08-25T10:00:00.000Z'),
      quotedLeadTimeDays: 21,
      paymentTermsOffered: '45 days',
      validityDays: 30,
      notes: 'Freight extra.',
      totalQuotedValue: '520380.00',
      attachmentCount: 2,
      lines: [
        {
          itemCode: 'ITM-0001',
          itemName: '27U Rack 800 x 800',
          quantity: '10.0000',
          unitOfMeasure: 'NOS',
          specificationNotes: 'Powder coated',
          targetPrice: null,
          unitPrice: '52038.00',
          lineTotal: '520380.00',
          deliveryLeadTimeDays: 21,
          remarks: 'Ex-works',
        },
      ],
    });
    expect(bytes.byteLength).toBeGreaterThan(500);
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});

describe('RfqQuoteVaultService', () => {
  let prisma: any;
  let storage: any;
  let service: RfqQuoteVaultService;

  const invitee = {
    id: 'invitee-1',
    supplierId: null,
    vendorId: 'vendor-1',
    submittedAt: new Date('2026-08-25T10:00:00.000Z'),
    supplier: null,
    vendor: { companyName: 'Vigyanlabs Innovations' },
    rfq: {
      rfqNumber: 'RFQ-2026-0007',
      submissionDeadline: new Date('2026-09-01T00:00:00.000Z'),
      requiredByDate: null,
      deliveryLocation: null,
      paymentTermsRequested: null,
      createdById: 'employee-1',
    },
    quote: {
      quotedLeadTimeDays: 21,
      paymentTermsOffered: null,
      validityDays: null,
      notes: null,
      attachmentFileKeys: ['rfq-quotes/invitee-1/attachments/aa'],
      totalQuotedValue: D('520380.00'),
      lines: [
        {
          unitPrice: D('52038.00'),
          lineTotal: D('520380.00'),
          deliveryLeadTimeDays: 21,
          remarks: null,
          rfqLine: {
            sequence: 1,
            quantity: D('10'),
            unitOfMeasure: 'NOS',
            specificationNotes: null,
            item: { itemCode: 'ITM-0001', name: '27U Rack' },
          },
        },
        {
          unitPrice: D('100.00'),
          lineTotal: D('200.00'),
          deliveryLeadTimeDays: null,
          remarks: null,
          rfqLine: {
            sequence: 0,
            quantity: D('2'),
            unitOfMeasure: 'NOS',
            specificationNotes: null,
            item: { itemCode: 'ITM-0002', name: 'PDU' },
          },
        },
      ],
    },
  };

  beforeEach(() => {
    prisma = {
      rfqInvitee: { findUniqueOrThrow: jest.fn().mockResolvedValue(invitee) },
      vaultFolder: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'folder-1', maxVersionsRetained: 5 }),
      },
      vaultFile: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
      },
      vaultFileVersion: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'version-1' }),
        delete: jest.fn(),
      },
      $transaction: jest.fn((fn: any) => fn(prisma)),
    };
    storage = {
      buildStorageKey: jest.fn(
        (fileId: string, v: number) => `vault/files/${fileId}/v${v}`,
      ),
      putObjectBytes: jest.fn(),
      deleteObject: jest.fn(),
    };
    service = new RfqQuoteVaultService(prisma, storage);
  });

  it('uploads the PDF then creates an ACTIVE file with version 1 in the RFQ Quotes folder', async () => {
    const result = await service.fileSubmittedQuote('invitee-1');

    expect(prisma.vaultFolder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ name: RFQ_QUOTES_FOLDER_NAME }),
      }),
    );
    expect(result.name).toBe('RFQ-2026-0007_Vigyanlabs-Innovations_Quote.pdf');
    expect(result.versionNumber).toBe(1);

    const [, bytes, contentType] = storage.putObjectBytes.mock.calls[0];
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(contentType).toBe('application/pdf');

    expect(prisma.vaultFile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        folderId: 'folder-1',
        name: 'RFQ-2026-0007_Vigyanlabs-Innovations_Quote.pdf',
        uploadedById: 'employee-1',
        status: 'ACTIVE',
      }),
    });
    expect(prisma.vaultFileVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        versionNumber: 1,
        mimeType: 'application/pdf',
        uploadedById: 'employee-1',
      }),
    });
    expect(prisma.vaultFile.update).toHaveBeenCalledWith({
      where: { id: expect.any(String) },
      data: { currentVersionId: 'version-1' },
    });
  });

  it('adds a version to the existing file when the same partner resubmits', async () => {
    prisma.vaultFile.findFirst.mockResolvedValue({ id: 'file-1' });
    prisma.vaultFileVersion.findFirst.mockResolvedValue({ versionNumber: 2 });

    const result = await service.fileSubmittedQuote('invitee-1');

    expect(result).toEqual({
      fileId: 'file-1',
      versionNumber: 3,
      name: 'RFQ-2026-0007_Vigyanlabs-Innovations_Quote.pdf',
    });
    expect(prisma.vaultFile.create).not.toHaveBeenCalled();
    expect(storage.putObjectBytes.mock.calls[0][0]).toBe(
      'vault/files/file-1/v3',
    );
    expect(prisma.vaultFile.update).toHaveBeenCalledWith({
      where: { id: 'file-1' },
      data: { currentVersionId: 'version-1', status: 'ACTIVE' },
    });
  });

  it('prunes the oldest versions past the folder cap, freeing the objects', async () => {
    prisma.vaultFile.findFirst.mockResolvedValue({ id: 'file-1' });
    prisma.vaultFileVersion.findFirst.mockResolvedValue({ versionNumber: 5 });
    prisma.vaultFileVersion.findMany.mockResolvedValue([
      { id: 'v1', storageKey: 'vault/files/file-1/v1' },
      { id: 'v2', storageKey: 'vault/files/file-1/v2' },
      { id: 'v3', storageKey: 'vault/files/file-1/v3' },
      { id: 'v4', storageKey: 'vault/files/file-1/v4' },
      { id: 'v5', storageKey: 'vault/files/file-1/v5' },
      { id: 'v6', storageKey: 'vault/files/file-1/v6' },
    ]);

    await service.fileSubmittedQuote('invitee-1');

    expect(storage.deleteObject).toHaveBeenCalledTimes(1);
    expect(storage.deleteObject).toHaveBeenCalledWith('vault/files/file-1/v1');
    expect(prisma.vaultFileVersion.delete).toHaveBeenCalledWith({
      where: { id: 'v1' },
    });
  });

  it('throws when the RFQ Quotes folder is not provisioned', async () => {
    prisma.vaultFolder.findFirst.mockResolvedValue(null);
    await expect(service.fileSubmittedQuote('invitee-1')).rejects.toThrow(
      NotFoundException,
    );
    expect(storage.putObjectBytes).not.toHaveBeenCalled();
  });

  it('tryFileSubmittedQuote swallows failures so a vendor submit never breaks', async () => {
    storage.putObjectBytes.mockRejectedValue(new Error('R2 is down'));
    await expect(
      service.tryFileSubmittedQuote('invitee-1'),
    ).resolves.toBeUndefined();
  });
});
