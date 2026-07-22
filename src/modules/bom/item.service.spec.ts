import { BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ITEM_CODE_PREFIX, ItemService } from './item.service';

describe('ItemService — itemCode generation', () => {
  const user = { id: 'rd-head-1', email: 'head@example.com', role: Role.EMPLOYEE, verticalId: 'rnd' };

  let access: any;
  let numbering: any;
  let prisma: any;
  let service: ItemService;

  beforeEach(() => {
    access = { assertCanManageItems: jest.fn().mockResolvedValue(undefined) };
    numbering = {
      nextContinuousNumber: jest.fn(),
      peekNextContinuousNumber: jest.fn(),
    };
    prisma = {
      item: { create: jest.fn() },
      $transaction: jest.fn((cb: any) => cb({ item: prisma.item })),
    };
    service = new ItemService(prisma, access, numbering);
  });

  describe('ITEM_CODE_PREFIX', () => {
    it('maps every ItemType to a distinct 2-letter prefix', () => {
      expect(ITEM_CODE_PREFIX).toEqual({
        RAW_MATERIAL: 'RM',
        COMPONENT: 'CM',
        SUBASSEMBLY: 'SA',
        FINISHED_GOOD: 'FG',
        CONSUMABLE: 'CN',
      });
      const prefixes = Object.values(ITEM_CODE_PREFIX);
      expect(new Set(prefixes).size).toBe(prefixes.length);
    });
  });

  describe('create', () => {
    it('generates the itemCode via the numbering service using the type-specific prefix, inside a transaction', async () => {
      numbering.nextContinuousNumber.mockResolvedValue('CM-00456');
      prisma.item.create.mockResolvedValue({
        id: 'item-1',
        itemCode: 'CM-00456',
        name: 'Bracket',
        description: null,
        itemType: 'COMPONENT',
        baseUnitOfMeasure: 'pcs',
        isActive: true,
        defaultWastagePercent: null,
        drawingSpecReference: null,
        standardLeadTimeDays: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.create(
        { name: 'Bracket', itemType: 'COMPONENT' as any, baseUnitOfMeasure: 'pcs' },
        user,
      );

      expect(numbering.nextContinuousNumber).toHaveBeenCalledWith(
        'CM',
        'item_component',
        expect.anything(),
      );
      expect(prisma.item.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ itemCode: 'CM-00456' }) }),
      );
      expect(result.itemCode).toBe('CM-00456');
    });

    it('does not accept a caller-supplied itemCode (DTO has no such field)', async () => {
      numbering.nextContinuousNumber.mockResolvedValue('RM-00001');
      prisma.item.create.mockResolvedValue({
        id: 'item-2',
        itemCode: 'RM-00001',
        name: 'Steel sheet',
        description: null,
        itemType: 'RAW_MATERIAL',
        baseUnitOfMeasure: 'kg',
        isActive: true,
        defaultWastagePercent: null,
        drawingSpecReference: null,
        standardLeadTimeDays: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const dto = { name: 'Steel sheet', itemType: 'RAW_MATERIAL' as any, baseUnitOfMeasure: 'kg' };
      // @ts-expect-error itemCode is not a valid CreateItemDto field
      dto.itemCode = 'SNEAKY-001';

      const result = await service.create(dto, user);
      expect(result.itemCode).toBe('RM-00001');
    });
  });

  describe('previewNextItemCode', () => {
    it('previews using the type-specific prefix without generating a real code', async () => {
      numbering.peekNextContinuousNumber.mockResolvedValue('FG-00012');
      const preview = await service.previewNextItemCode('FINISHED_GOOD' as any, user);
      expect(preview).toBe('FG-00012');
      expect(numbering.peekNextContinuousNumber).toHaveBeenCalledWith('FG', 'item_finished_good');
      expect(numbering.nextContinuousNumber).not.toHaveBeenCalled();
    });

    it('rejects an invalid itemType before calling the numbering service', async () => {
      await expect(
        service.previewNextItemCode('NOT_A_TYPE' as any, user),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(numbering.peekNextContinuousNumber).not.toHaveBeenCalled();
    });
  });

  describe('independent sequences per type', () => {
    it('uses a distinct sequence entity key for each itemType, so one type creating does not affect another', async () => {
      const seenEntities: string[] = [];
      numbering.nextContinuousNumber.mockImplementation((_prefix: string, entity: string) => {
        seenEntities.push(entity);
        return Promise.resolve(`X-${seenEntities.length}`);
      });
      prisma.item.create.mockImplementation(({ data }: any) => Promise.resolve({
        id: 'x', description: null, isActive: true, defaultWastagePercent: null,
        drawingSpecReference: null, standardLeadTimeDays: null,
        createdAt: new Date(), updatedAt: new Date(), ...data,
      }));

      await service.create({ name: 'A', itemType: 'RAW_MATERIAL' as any, baseUnitOfMeasure: 'kg' }, user);
      await service.create({ name: 'B', itemType: 'COMPONENT' as any, baseUnitOfMeasure: 'pcs' }, user);

      expect(seenEntities).toEqual(['item_raw_material', 'item_component']);
      expect(new Set(seenEntities).size).toBe(2);
    });
  });
});
