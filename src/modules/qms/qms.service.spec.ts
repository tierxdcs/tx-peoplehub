import { BadRequestException, NotFoundException } from '@nestjs/common';
import { QmsService } from './qms.service';

describe('QmsService — order-line linking', () => {
  let prisma: any;
  let access: any;
  let service: QmsService;
  const user: any = { id: 'qc-1', role: 'EMPLOYEE' };

  beforeEach(() => {
    prisma = {
      qmsInspection: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'insp-1' }),
        create: jest.fn(),
      },
      orderLineItem: { findUnique: jest.fn() },
      qmsQuestionTemplate: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };
    access = { assertUser: jest.fn().mockResolvedValue(undefined) };
    const notifications = { notifyPlm: jest.fn() };
    service = new QmsService(
      prisma as never,
      access as never,
      notifications as never,
    );
  });

  describe('linkInspection', () => {
    it('links an order line and mirrors its order/product onto the inspection', async () => {
      prisma.qmsInspection.findUnique.mockResolvedValue({
        id: 'insp-1',
        status: 'PENDING_REVIEW',
      });
      prisma.orderLineItem.findUnique.mockResolvedValue({
        id: 'line-1',
        orderId: 'order-1',
        productId: 'prod-1',
      });

      await service.linkInspection('insp-1', { orderLineId: 'line-1' }, user);

      expect(prisma.qmsInspection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'insp-1' },
          data: expect.objectContaining({
            orderLineId: 'line-1',
            orderId: 'order-1',
            productId: 'prod-1',
          }),
        }),
      );
    });

    it('allows linking an already-passed inspection so it can satisfy the QC gate', async () => {
      prisma.qmsInspection.findUnique.mockResolvedValue({
        id: 'insp-1',
        status: 'PASSED',
      });
      prisma.orderLineItem.findUnique.mockResolvedValue({
        id: 'line-1',
        orderId: 'order-1',
        productId: 'prod-1',
      });

      await expect(
        service.linkInspection('insp-1', { orderLineId: 'line-1' }, user),
      ).resolves.toBeDefined();
      expect(prisma.qmsInspection.update).toHaveBeenCalled();
    });

    it('rejects linking a FAILED inspection', async () => {
      prisma.qmsInspection.findUnique.mockResolvedValue({
        id: 'insp-1',
        status: 'FAILED',
      });

      await expect(
        service.linkInspection('insp-1', { orderLineId: 'line-1' }, user),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.orderLineItem.findUnique).not.toHaveBeenCalled();
      expect(prisma.qmsInspection.update).not.toHaveBeenCalled();
    });

    it('throws when the order line does not exist', async () => {
      prisma.qmsInspection.findUnique.mockResolvedValue({
        id: 'insp-1',
        status: 'IN_PROGRESS',
      });
      prisma.orderLineItem.findUnique.mockResolvedValue(null);

      await expect(
        service.linkInspection('insp-1', { orderLineId: 'missing' }, user),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.qmsInspection.update).not.toHaveBeenCalled();
    });

    it('throws when the inspection does not exist', async () => {
      prisma.qmsInspection.findUnique.mockResolvedValue(null);

      await expect(
        service.linkInspection('nope', { orderLineId: 'line-1' }, user),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('createInspection', () => {
    it('persists the provided orderLineId on the new inspection', async () => {
      prisma.qmsQuestionTemplate.findUnique.mockResolvedValue({
        id: 'tpl-1',
        status: 'APPROVED',
        templateCode: 'T1',
        templateType: 'FINAL',
        version: 1,
        name: 'Final',
        questions: [],
      });
      const create = jest.fn().mockResolvedValue({ id: 'insp-1' });
      const tx = {
        qmsInspection: { create },
        financeSequence: {
          upsert: jest.fn().mockResolvedValue({ lastValue: 1 }),
        },
      };
      prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

      await service.createInspection(
        { templateId: 'tpl-1', orderLineId: 'line-1' } as never,
        user,
      );

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ orderLineId: 'line-1' }),
        }),
      );
    });
  });
});
