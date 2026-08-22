import { BadRequestException, NotFoundException } from '@nestjs/common';
import { QmsService } from './qms.service';

describe('QmsService — order-line linking', () => {
  let prisma: any;
  let access: any;
  let itemCosts: any;
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
      qmsNonConformance: { findUnique: jest.fn(), update: jest.fn(), upsert: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      nonConformanceReport: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(),
    };
    access = { assertUser: jest.fn().mockResolvedValue(undefined) };
    access.assertHead = jest.fn().mockResolvedValue(undefined);
    const notifications = { notifyPlm: jest.fn() };
    itemCosts = { currentFailureCost: jest.fn() };
    service = new QmsService(
      prisma as never,
      access as never,
      notifications as never,
      itemCosts as never,
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

  describe('COPQ disposition', () => {
    it('calculates Scrap from affected quantity and realized item cost', async () => {
      prisma.qmsNonConformance.findUnique.mockResolvedValue({ id:'n-1', status:'CONTAINED', itemId:'item-1', affectedQuantity:3, capa:null });
      prisma.qmsNonConformance.update.mockResolvedValue({ id:'n-1' });
      itemCosts.currentFailureCost.mockResolvedValue({ amount:{ mul:(q:any)=>Number(q)*125 }, source:'LATEST_ACCEPTED_GRN' });
      await service.dispositionNcr('n-1', { disposition:'SCRAP' } as never, user);
      expect(prisma.qmsNonConformance.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({costOfPoorQuality:375,costOfPoorQualitySource:'SYSTEM_CALCULATED'})}));
    });

    it('does not invent a cost for Rework', async () => {
      prisma.qmsNonConformance.findUnique.mockResolvedValue({ id:'n-1', status:'CONTAINED', itemId:'item-1', affectedQuantity:3, capa:null });
      await service.dispositionNcr('n-1', { disposition:'REWORK' } as never, user);
      expect(itemCosts.currentFailureCost).not.toHaveBeenCalled();
      expect(prisma.qmsNonConformance.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({costOfPoorQuality:null,costOfPoorQualitySource:null})}));
    });

    it('marks an entered override as manual', async () => {
      prisma.qmsNonConformance.findUnique.mockResolvedValue({ id:'n-1', status:'CONTAINED', itemId:'item-1', affectedQuantity:3, capa:null });
      await service.dispositionNcr('n-1', { disposition:'SCRAP', costOfPoorQuality:280 } as never, user);
      expect(itemCosts.currentFailureCost).not.toHaveBeenCalled();
      expect(prisma.qmsNonConformance.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({costOfPoorQualitySource:'MANUAL'})}));
    });
  });

  describe('Stores NCR synchronization', () => {
    it('applies the same calculated Scrap cost during sync', async () => {
      prisma.nonConformanceReport.findMany.mockResolvedValue([{id:'store-ncr',ncrNumber:'NCR-1',status:'DISPOSITIONED',itemId:'item-1',item:{name:'Steel'},grnId:'grn-1',rejectedQuantity:2,raisedById:'qc-1',createdAt:new Date(),updatedAt:new Date(),disposition:'SCRAP',dispositionNotes:null,rejectionReason:'Damaged'}]);
      prisma.qmsNonConformance.findUnique.mockResolvedValue(null);
      itemCosts.currentFailureCost.mockResolvedValue({amount:{mul:(q:any)=>Number(q)*50},source:'MANUAL_STANDARD'});
      await service.ncrs(user);
      expect(prisma.qmsNonConformance.upsert).toHaveBeenCalledWith(expect.objectContaining({create:expect.objectContaining({costOfPoorQuality:100,costOfPoorQualitySource:'SYSTEM_CALCULATED'})}));
    });

    it('does not overwrite a manual Stores-NCR cost override', async () => {
      prisma.nonConformanceReport.findMany.mockResolvedValue([{id:'store-ncr',ncrNumber:'NCR-1',status:'DISPOSITIONED',itemId:'item-1',item:{name:'Steel'},grnId:'grn-1',rejectedQuantity:2,raisedById:'qc-1',createdAt:new Date(),updatedAt:new Date(),disposition:'SCRAP',dispositionNotes:null,rejectionReason:'Damaged'}]);
      prisma.qmsNonConformance.findUnique.mockResolvedValue({costOfPoorQualitySource:'MANUAL'});
      await service.ncrs(user);
      expect(itemCosts.currentFailureCost).not.toHaveBeenCalled();
      expect(prisma.qmsNonConformance.upsert.mock.calls[0][0].update).not.toHaveProperty('costOfPoorQuality');
    });
  });
});
