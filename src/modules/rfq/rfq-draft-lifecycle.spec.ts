import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RfqService } from './rfq.service';

const D = (value: string | number) => new Prisma.Decimal(value);

const itemCatalogue = [
  { id: 'item-a', isActive: true, baseUnitOfMeasure: 'ea' },
  { id: 'item-b', isActive: true, baseUnitOfMeasure: 'kg' },
  { id: 'item-c', isActive: true, baseUnitOfMeasure: 'm' },
];

/**
 * Saving a DRAFT and deleting a DRAFT. The two behaviours worth pinning down:
 * an edit must reconcile lines in place (RfqAttachment cascades off RfqLine, so
 * delete-all-recreate would take every technical drawing with it), and both
 * paths must be closed the moment the RFQ leaves DRAFT.
 */
describe('RfqService draft save / delete', () => {
  let prisma: any;
  let access: any;
  let storage: any;
  let tx: any;
  let service: RfqService;

  beforeEach(() => {
    tx = {
      rfq: { update: jest.fn() },
      rfqLine: {
        deleteMany: jest.fn(),
        update: jest.fn(),
        createMany: jest.fn(),
      },
    };
    prisma = {
      rfq: { findUnique: jest.fn(), delete: jest.fn() },
      rfqLine: { findMany: jest.fn().mockResolvedValue([]) },
      rfqAttachment: { findMany: jest.fn().mockResolvedValue([]) },
      // Mirror the real query's id filter — resolveLines cross-checks the
      // returned row count against the ids it asked for.
      item: {
        findMany: jest.fn(({ where }: any) =>
          Promise.resolve(
            itemCatalogue.filter((item) => where.id.in.includes(item.id)),
          ),
        ),
      },
      $transaction: jest.fn((cb: any) => cb(tx)),
    };
    access = {
      assertCanManageRfqs: jest.fn(),
      assertCanReadRfqs: jest.fn(),
    };
    storage = { deleteObjectStrict: jest.fn() };
    service = new RfqService(
      prisma,
      access,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      storage,
    );
    jest
      .spyOn(service, 'get')
      .mockResolvedValue({ id: 'rfq-1' } as unknown as never);
  });

  const user = { id: 'u1' } as never;

  function draft(overrides: Record<string, unknown> = {}) {
    prisma.rfq.findUnique.mockResolvedValue({
      id: 'rfq-1',
      status: 'DRAFT',
      projectKickoffId: null,
      ...overrides,
    });
  }

  /** Two persisted lines: 10 of item-a, 5 of item-b. */
  function persistedLines() {
    prisma.rfqLine.findMany.mockResolvedValue([
      {
        id: 'line-a',
        itemId: 'item-a',
        quantity: D(10),
        unitOfMeasure: 'ea',
        specificationNotes: null,
        sequence: 0,
      },
      {
        id: 'line-b',
        itemId: 'item-b',
        quantity: D(5),
        unitOfMeasure: 'kg',
        specificationNotes: null,
        sequence: 1,
      },
    ]);
  }

  const rfqData = () => tx.rfq.update.mock.calls[0][0].data;

  describe('update (save draft)', () => {
    it('saves scalar fields without touching the lines or the PM approval', async () => {
      draft();
      await service.update('rfq-1', { title: 'Revised title' }, user);

      expect(rfqData()).toEqual({ title: 'Revised title' });
      expect(prisma.rfqLine.findMany).not.toHaveBeenCalled();
      expect(tx.rfqLine.deleteMany).not.toHaveBeenCalled();
      expect(tx.rfqLine.createMany).not.toHaveBeenCalled();
    });

    it('updates a changed quantity in place — the line keeps its id, so its drawings survive', async () => {
      draft();
      persistedLines();
      await service.update(
        'rfq-1',
        {
          lines: [
            { itemId: 'item-a', quantity: 12 },
            { itemId: 'item-b', quantity: 5, sequence: 1 },
          ],
        },
        user,
      );

      expect(tx.rfqLine.update).toHaveBeenCalledTimes(1);
      expect(tx.rfqLine.update.mock.calls[0][0].where).toEqual({
        id: 'line-a',
      });
      expect(tx.rfqLine.update.mock.calls[0][0].data.quantity.toString()).toBe(
        '12',
      );
      expect(tx.rfqLine.deleteMany).not.toHaveBeenCalled();
      expect(tx.rfqLine.createMany).not.toHaveBeenCalled();
      // The approver signed off on 10, not 12.
      expect(rfqData()).toMatchObject({
        pmApprovedById: null,
        pmApprovedAt: null,
      });
    });

    it('keeps the PM approval when only the line order changed', async () => {
      draft();
      persistedLines();
      await service.update(
        'rfq-1',
        {
          lines: [
            { itemId: 'item-b', quantity: 5 },
            { itemId: 'item-a', quantity: 10 },
          ],
        },
        user,
      );

      // Both lines get a new sequence, but nothing quotable moved.
      expect(tx.rfqLine.update).toHaveBeenCalledTimes(2);
      expect(rfqData().pmApprovedAt).toBeUndefined();
    });

    it('removes a dropped line and purges its drawing from storage', async () => {
      draft();
      persistedLines();
      prisma.rfqAttachment.findMany.mockResolvedValue([
        { fileKey: 'rfq/line-b/drawing.pdf' },
      ]);
      await service.update(
        'rfq-1',
        { lines: [{ itemId: 'item-a', quantity: 10 }] },
        user,
      );

      expect(prisma.rfqAttachment.findMany).toHaveBeenCalledWith({
        where: { rfqLineId: { in: ['line-b'] } },
        select: { fileKey: true },
      });
      expect(storage.deleteObjectStrict).toHaveBeenCalledWith(
        'rfq/line-b/drawing.pdf',
      );
      expect(tx.rfqLine.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['line-b'] } },
      });
      expect(rfqData()).toMatchObject({ pmApprovedById: null });
    });

    it('creates a newly added line', async () => {
      draft();
      persistedLines();
      await service.update(
        'rfq-1',
        {
          lines: [
            { itemId: 'item-a', quantity: 10 },
            { itemId: 'item-b', quantity: 5 },
            { itemId: 'item-c', quantity: 3 },
          ],
        },
        user,
      );

      expect(tx.rfqLine.createMany).toHaveBeenCalledTimes(1);
      const created = tx.rfqLine.createMany.mock.calls[0][0].data;
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({
        rfqId: 'rfq-1',
        itemId: 'item-c',
        // UoM defaults to the item's base unit when the caller omits it.
        unitOfMeasure: 'm',
        sequence: 2,
      });
    });

    it('refuses to edit an RFQ that has left DRAFT', async () => {
      draft({ status: 'ISSUED' });
      await expect(
        service.update('rfq-1', { title: 'nope' }, user),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('remove (delete draft)', () => {
    it('deletes the draft and purges its attachment objects', async () => {
      prisma.rfq.findUnique.mockResolvedValue({
        status: 'DRAFT',
        attachments: [{ fileKey: 'rfq/a.pdf' }, { fileKey: 'rfq/b.pdf' }],
        invitees: [{ quote: null }],
      });
      await service.remove('rfq-1', user);

      expect(storage.deleteObjectStrict).toHaveBeenCalledTimes(2);
      expect(prisma.rfq.delete).toHaveBeenCalledWith({
        where: { id: 'rfq-1' },
      });
    });

    it('refuses to delete anything past DRAFT', async () => {
      prisma.rfq.findUnique.mockResolvedValue({
        status: 'ISSUED',
        attachments: [],
        invitees: [],
      });
      await expect(service.remove('rfq-1', user)).rejects.toThrow(
        /Only a DRAFT RFQ can be deleted/,
      );
      expect(prisma.rfq.delete).not.toHaveBeenCalled();
    });

    it('refuses to destroy a partner quote that somehow exists', async () => {
      prisma.rfq.findUnique.mockResolvedValue({
        status: 'DRAFT',
        attachments: [],
        invitees: [{ quote: null }, { quote: { id: 'q1' } }],
      });
      await expect(service.remove('rfq-1', user)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(storage.deleteObjectStrict).not.toHaveBeenCalled();
      expect(prisma.rfq.delete).not.toHaveBeenCalled();
    });

    it('404s for an unknown RFQ', async () => {
      prisma.rfq.findUnique.mockResolvedValue(null);
      await expect(service.remove('nope', user)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('requires SCM manage rights', async () => {
      access.assertCanManageRfqs.mockRejectedValue(new Error('forbidden'));
      await expect(service.remove('rfq-1', user)).rejects.toThrow('forbidden');
      expect(prisma.rfq.findUnique).not.toHaveBeenCalled();
    });
  });
});
