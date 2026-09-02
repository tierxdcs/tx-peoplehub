import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { StatutoryConfigType } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import {
  COMPANY_PT_STATE,
  StatutoryConfigService,
} from './statutory-config.service';

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

    it('rejects a field no computation reads, rather than storing it as if it were live', async () => {
      // The case that motivated this: a hand-typed `monthOverrides` sat on a
      // Professional Tax row looking like a February-differential rule while
      // nothing in payroll ever read it.
      await expect(
        service.create({
          configType: StatutoryConfigType.PROFESSIONAL_TAX,
          state: 'Karnataka',
          effectiveFrom: '2026-01-01',
          configData: {
            slabs: [{ slabFrom: 0, slabTo: null, amount: 200 }],
            monthOverrides: { '2': 300 },
          },
          sourceNote: 'test',
        }),
      ).rejects.toThrow(/unknown field\(s\): monthOverrides/);
    });

    it('rejects a non-numeric rate', async () => {
      await expect(
        service.create({
          configType: StatutoryConfigType.ESI,
          effectiveFrom: '2026-01-01',
          configData: {
            employeeRate: '0.75%',
            employerRate: 0.0325,
            wageThreshold: 21000,
          },
          sourceNote: 'test',
        }),
      ).rejects.toThrow(/employeeRate .* must be a finite number/);
    });

    it('rejects a slab ladder that does not end open-ended — the silent zero for high earners', async () => {
      await expect(
        service.create({
          configType: StatutoryConfigType.PROFESSIONAL_TAX,
          state: 'Karnataka',
          effectiveFrom: '2026-01-01',
          configData: {
            slabs: [
              { slabFrom: 0, slabTo: 24999.99, amount: 0 },
              { slabFrom: 25000, slabTo: 9999999, amount: 200 },
            ],
          },
          sourceNote: 'test',
        }),
      ).rejects.toThrow(/must end in an open-ended slab/);
    });

    it('rejects a PT slab keyed with a TDS-style rate', async () => {
      await expect(
        service.create({
          configType: StatutoryConfigType.PROFESSIONAL_TAX,
          state: 'Karnataka',
          effectiveFrom: '2026-01-01',
          configData: { slabs: [{ slabFrom: 0, slabTo: null, rate: 0.02 }] },
          sourceNote: 'test',
        }),
      ).rejects.toThrow(/is missing amount/);
    });

    it('rejects overlapping slabs', async () => {
      await expect(
        service.create({
          configType: StatutoryConfigType.TDS_SLAB,
          effectiveFrom: '2026-01-01',
          configData: {
            slabs: [
              { slabFrom: 0, slabTo: 400000, rate: 0 },
              { slabFrom: 300000, slabTo: null, rate: 0.05 },
            ],
          },
          sourceNote: 'test',
        }),
      ).rejects.toThrow(/overlaps the slab before it/);
    });

    it('rejects an empty slab ladder', async () => {
      await expect(
        service.create({
          configType: StatutoryConfigType.TDS_SLAB,
          effectiveFrom: '2026-01-01',
          configData: { slabs: [] },
          sourceNote: 'test',
        }),
      ).rejects.toThrow(/non-empty array/);
    });

    it('accepts the Karnataka PT ladder in force, gap at the paise boundary and all', async () => {
      prisma.statutoryConfig.findFirst.mockResolvedValue(null);
      prisma.statutoryConfig.create.mockResolvedValue({
        id: 'pt-1',
        configType: StatutoryConfigType.PROFESSIONAL_TAX,
        state: 'Karnataka',
        effectiveFrom: new Date('2026-01-01'),
        effectiveTo: null,
        configData: {},
        sourceNote: 'test',
      });

      await expect(
        service.create({
          configType: StatutoryConfigType.PROFESSIONAL_TAX,
          state: 'Karnataka',
          effectiveFrom: '2026-01-01',
          configData: {
            slabs: [
              { slabFrom: 0, slabTo: 24999.99, amount: 0 },
              { slabFrom: 25000, slabTo: null, amount: 200 },
            ],
          },
          sourceNote: 'test',
        }),
      ).resolves.toBeDefined();
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

  describe('findProfessionalTax', () => {
    const asOf = new Date('2026-08-01');
    const ptRowFor = (state: string) => ({ id: `pt-${state}`, state });

    it('prefers a row configured for the exact work location', async () => {
      prisma.statutoryConfig.findFirst.mockImplementation(
        ({ where }: { where: { state?: string } }) =>
          Promise.resolve(
            where.state === 'Unit 1 - Peenya'
              ? ptRowFor('Unit 1 - Peenya')
              : null,
          ),
      );

      const result = await service.findProfessionalTax('Unit 1 - Peenya', asOf);

      expect(result).toEqual(ptRowFor('Unit 1 - Peenya'));
    });

    it('falls back to the company state when the work location is not a configured PT state', async () => {
      // workLocation is free text ("Hybrid") and never equals a state name,
      // so this fallback is the normal path, not the edge case.
      prisma.statutoryConfig.findFirst.mockImplementation(
        ({ where }: { where: { state?: string } }) =>
          Promise.resolve(
            where.state === COMPANY_PT_STATE
              ? ptRowFor(COMPANY_PT_STATE)
              : null,
          ),
      );

      const result = await service.findProfessionalTax('Hybrid', asOf);

      expect(result).toEqual(ptRowFor(COMPANY_PT_STATE));
    });

    it('uses the company state when there is no work location at all', async () => {
      prisma.statutoryConfig.findFirst.mockResolvedValue(
        ptRowFor(COMPANY_PT_STATE),
      );

      const result = await service.findProfessionalTax(null, asOf);

      expect(result).toEqual(ptRowFor(COMPANY_PT_STATE));
      expect(prisma.statutoryConfig.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.statutoryConfig.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ state: COMPANY_PT_STATE }),
        }),
      );
    });

    it('returns null when neither the location nor the company state has a row', async () => {
      prisma.statutoryConfig.findFirst.mockResolvedValue(null);

      await expect(
        service.findProfessionalTax('Hybrid', asOf),
      ).resolves.toBeNull();
    });
  });
});
