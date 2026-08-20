import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { StatutoryConfigType } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { StatutoryConfigService } from './statutory-config.service';

describe('StatutoryConfigService', () => {
  let service: StatutoryConfigService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      statutoryConfig: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StatutoryConfigService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(StatutoryConfigService);
  });

  describe('update', () => {
    const pfDto = {
      configType: StatutoryConfigType.PF,
      effectiveFrom: '2026-01-01',
      configData: {
        employeeRate: 0.12,
        employerRate: 0.13,
        epsRate: 0.0833,
        wageCeiling: 15000,
        adminCharge: 0.005,
      },
      sourceNote: 'Compliance reviewed',
    };

    it('updates a version while excluding itself from overlap validation', async () => {
      const existing = {
        id: 'config-1',
        configType: StatutoryConfigType.PF,
        state: null,
        effectiveFrom: new Date('2026-01-01'),
        effectiveTo: null,
        configData: pfDto.configData,
        sourceNote: 'Old note',
      };
      prisma.statutoryConfig.findUnique.mockResolvedValue(existing);
      prisma.statutoryConfig.findFirst.mockResolvedValue(null);
      prisma.statutoryConfig.update.mockResolvedValue({
        ...existing,
        sourceNote: pfDto.sourceNote,
      });

      const result = await service.update('config-1', pfDto);

      expect(prisma.statutoryConfig.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { not: 'config-1' } }),
        }),
      );
      expect(prisma.statutoryConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'config-1' } }),
      );
      expect(result.sourceNote).toBe('Compliance reviewed');
    });

    it('rejects changing the configuration type', async () => {
      prisma.statutoryConfig.findUnique.mockResolvedValue({
        id: 'config-1',
        configType: StatutoryConfigType.ESI,
      });

      await expect(service.update('config-1', pfDto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects an unknown version', async () => {
      prisma.statutoryConfig.findUnique.mockResolvedValue(null);

      await expect(service.update('missing', pfDto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('rejects PF configData missing a required field', async () => {
      await expect(
        service.create({
          configType: StatutoryConfigType.PF,
          effectiveFrom: '2026-01-01',
          configData: { employeeRate: 0.12 }, // missing employerRate, epsRate, wageCeiling, adminCharge
          sourceNote: 'test',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts PF configData with all required fields', async () => {
      prisma.statutoryConfig.findFirst.mockResolvedValue(null);
      prisma.statutoryConfig.create.mockResolvedValue({
        id: '1',
        configType: StatutoryConfigType.PF,
        state: null,
        effectiveFrom: new Date('2026-01-01'),
        effectiveTo: null,
        configData: {
          employeeRate: 0.12,
          employerRate: 0.12,
          epsRate: 0.0833,
          wageCeiling: 15000,
          adminCharge: 0.005,
        },
        sourceNote: 'test',
      });

      const result = await service.create({
        configType: StatutoryConfigType.PF,
        effectiveFrom: '2026-01-01',
        configData: {
          employeeRate: 0.12,
          employerRate: 0.12,
          epsRate: 0.0833,
          wageCeiling: 15000,
          adminCharge: 0.005,
        },
        sourceNote: 'test',
      });

      expect(result.id).toBe('1');
    });

    it('requires state for PROFESSIONAL_TAX', async () => {
      await expect(
        service.create({
          configType: StatutoryConfigType.PROFESSIONAL_TAX,
          effectiveFrom: '2026-01-01',
          configData: { slabs: [] },
          sourceNote: 'test',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects effectiveTo before effectiveFrom', async () => {
      await expect(
        service.create({
          configType: StatutoryConfigType.STANDARD_DEDUCTION,
          effectiveFrom: '2026-06-01',
          effectiveTo: '2026-01-01',
          configData: { amount: 50000 },
          sourceNote: 'test',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a config whose effective range overlaps an existing one', async () => {
      prisma.statutoryConfig.findFirst.mockResolvedValue({
        id: 'existing',
        configType: StatutoryConfigType.STANDARD_DEDUCTION,
        effectiveFrom: new Date('2026-01-01'),
        effectiveTo: null,
      });

      await expect(
        service.create({
          configType: StatutoryConfigType.STANDARD_DEDUCTION,
          effectiveFrom: '2026-06-01',
          configData: { amount: 60000 },
          sourceNote: 'test',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('findEffective', () => {
    it('queries by configType and effective-date range', async () => {
      prisma.statutoryConfig.findFirst.mockResolvedValue(null);

      await service.findEffective(
        StatutoryConfigType.PF,
        new Date('2026-08-01'),
      );

      expect(prisma.statutoryConfig.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            configType: StatutoryConfigType.PF,
          }),
        }),
      );
    });

    it('includes state in the query for PROFESSIONAL_TAX', async () => {
      prisma.statutoryConfig.findFirst.mockResolvedValue(null);

      await service.findEffective(
        StatutoryConfigType.PROFESSIONAL_TAX,
        new Date('2026-08-01'),
        'Karnataka',
      );

      expect(prisma.statutoryConfig.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ state: 'Karnataka' }),
        }),
      );
    });

    it('returns null when nothing is configured — this is the case that makes processRun refuse to run', async () => {
      prisma.statutoryConfig.findFirst.mockResolvedValue(null);

      const result = await service.findEffective(
        StatutoryConfigType.ESI,
        new Date('2026-08-01'),
      );

      expect(result).toBeNull();
    });
  });
});
