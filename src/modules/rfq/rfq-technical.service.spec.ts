import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MAX_FILE_SIZE_BYTES } from '../vault/vault-guardrails';
import { RfqTechnicalService } from './rfq-technical.service';

const D = (value: string | number) => new Prisma.Decimal(value);

describe('RfqTechnicalService', () => {
  const user = { id: 'employee-1' } as never;
  let prisma: any;
  let storage: any;
  let access: any;
  let service: RfqTechnicalService;

  beforeEach(() => {
    prisma = {
      rfq: { findUnique: jest.fn() },
      rfqLine: { findFirst: jest.fn() },
      rfqAttachment: { create: jest.fn(), findFirst: jest.fn() },
      bom: { findMany: jest.fn() },
      item: { findMany: jest.fn() },
    };
    storage = {
      createUploadUrl: jest.fn(),
      createDownloadUrl: jest.fn(),
      headObject: jest.fn(),
    };
    access = {
      assertCanReadRfqs: jest.fn(),
      assertCanManageRfqs: jest.fn(),
    };
    service = new RfqTechnicalService(prisma, storage, access);
  });

  it('renders the latest released BOM live, multiplied by RFQ quantity, without costs', async () => {
    prisma.rfq.findUnique.mockResolvedValue({
      id: 'rfq-1',
      lines: [
        {
          id: 'line-1',
          itemId: 'fg-1',
          quantity: D(2),
          item: { itemCode: 'FG-0001', name: 'Rack' },
        },
      ],
      attachments: [],
    });
    prisma.item.findMany.mockResolvedValue([
      {
        id: 'rm-1',
        itemCode: 'RM-0001',
        name: 'Steel sheet',
        drawingSpecReference: 'CRCA 1.2 mm',
      },
    ]);
    prisma.bom.findMany
      .mockResolvedValueOnce([
        {
          itemId: 'fg-1',
          revisionNumber: 1,
          lines: [
            {
              itemId: 'rm-1',
              quantityPerUnit: D(3),
              wastagePercent: D(0),
              unitOfMeasure: 'sheet',
            },
          ],
        },
      ])
      .mockResolvedValueOnce([
        {
          itemId: 'fg-1',
          revisionNumber: 2,
          lines: [
            {
              itemId: 'rm-1',
              quantityPerUnit: D(4),
              wastagePercent: D(0),
              unitOfMeasure: 'sheet',
            },
          ],
        },
      ]);

    const first = await service.view('rfq-1');
    const revised = await service.view('rfq-1');

    expect(first.lineBoms[0]).toMatchObject({
      revisionNumber: 1,
      components: [
        {
          itemCode: 'RM-0001',
          itemName: 'Steel sheet',
          quantity: '6',
          specification: 'CRCA 1.2 mm',
        },
      ],
    });
    expect(revised.lineBoms[0]).toMatchObject({
      revisionNumber: 2,
      components: [{ quantity: '8' }],
    });
    expect(JSON.stringify(revised)).not.toMatch(/unitPrice|cost|rate/i);
    expect(revised.maxDrawingFileSizeBytes).toBe(500 * 1024 * 1024);
  });

  it('rechecks the actual stored size during confirmation', async () => {
    prisma.rfq.findUnique.mockResolvedValue({ id: 'rfq-1' });
    storage.headObject.mockResolvedValue({
      sizeBytes: MAX_FILE_SIZE_BYTES + 1,
      contentType: 'application/pdf',
    });

    await expect(
      service.confirm(
        'rfq-1',
        {
          fileKey: 'rfqs/rfq-1/technical/object',
          fileName: 'drawing.pdf',
        },
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.rfqAttachment.create).not.toHaveBeenCalled();
  });

  it('only signs downloads for attachments belonging to the requested RFQ', async () => {
    prisma.rfqAttachment.findFirst.mockResolvedValue(null);

    await expect(service.download('rfq-1', 'attachment-2')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(storage.createDownloadUrl).not.toHaveBeenCalled();
  });
});
