import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { SalaryStructuresService } from './salary-structures.service';

describe('SalaryStructuresService', () => {
  let service: SalaryStructuresService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      employee: { findUnique: jest.fn() },
      salaryStructure: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalaryStructuresService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(SalaryStructuresService);
  });

  describe('create', () => {
    it('throws NotFoundException for a non-existent employee', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);

      await expect(
        service.create(
          {
            employeeId: 'nope',
            effectiveFrom: '2026-01-01',
            basic: 50000,
            hra: 10000,
            ctcAnnual: 780000,
          },
          'admin-1',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('creates a new row rather than editing a prior one (append-only history)', async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: 'emp-1' });
      prisma.salaryStructure.create.mockResolvedValue({
        id: 'new-row',
        employeeId: 'emp-1',
        effectiveFrom: new Date('2026-06-01'),
        basic: new Prisma.Decimal(55000),
        hra: new Prisma.Decimal(11000),
        specialAllowance: new Prisma.Decimal(0),
        otherAllowances: null,
        ctcAnnual: new Prisma.Decimal(792000),
      });

      const result = await service.create(
        {
          employeeId: 'emp-1',
          effectiveFrom: '2026-06-01',
          basic: 55000,
          hra: 11000,
          ctcAnnual: 792000,
        },
        'admin-1',
      );

      expect(prisma.salaryStructure.create).toHaveBeenCalled();
      expect(result.id).toBe('new-row');
    });
  });

  describe('getCurrent', () => {
    it('picks the row with the latest effectiveFrom <= asOf', async () => {
      prisma.salaryStructure.findFirst.mockResolvedValue({ id: 'latest' });

      const result = await service.getCurrent('emp-1', new Date('2026-08-01'));

      expect(prisma.salaryStructure.findFirst).toHaveBeenCalledWith({
        where: {
          employeeId: 'emp-1',
          effectiveFrom: { lte: new Date('2026-08-01') },
        },
        orderBy: { effectiveFrom: 'desc' },
      });
      expect(result?.id).toBe('latest');
    });
  });

  describe('getCurrentOrThrow', () => {
    it('throws NotFoundException when no structure is on file yet', async () => {
      prisma.salaryStructure.findFirst.mockResolvedValue(null);

      await expect(
        service.getCurrentOrThrow('emp-1', new Date('2026-08-01')),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getCurrentEntity', () => {
    it('returns null (not a throw) when no structure is on file yet', async () => {
      prisma.salaryStructure.findFirst.mockResolvedValue(null);

      const result = await service.getCurrentEntity('emp-1');
      expect(result).toBeNull();
    });

    it('returns the entity-shaped current structure when one exists', async () => {
      prisma.salaryStructure.findFirst.mockResolvedValue({
        id: 'row-1',
        employeeId: 'emp-1',
        effectiveFrom: new Date('2026-06-01'),
        basic: new Prisma.Decimal(55000),
        hra: new Prisma.Decimal(11000),
        specialAllowance: new Prisma.Decimal(0),
        otherAllowances: null,
        ctcAnnual: new Prisma.Decimal(792000),
      });

      const result = await service.getCurrentEntity('emp-1');
      expect(result?.id).toBe('row-1');
      expect(result?.basic).toBe('55000');
    });
  });

  describe('getHistory', () => {
    it('returns every row for the employee, most recent first', async () => {
      prisma.salaryStructure.findMany.mockResolvedValue([
        {
          id: 'row-2',
          employeeId: 'emp-1',
          effectiveFrom: new Date('2026-06-01'),
          basic: new Prisma.Decimal(55000),
          hra: new Prisma.Decimal(11000),
          specialAllowance: new Prisma.Decimal(0),
          otherAllowances: null,
          ctcAnnual: new Prisma.Decimal(792000),
        },
        {
          id: 'row-1',
          employeeId: 'emp-1',
          effectiveFrom: new Date('2026-01-01'),
          basic: new Prisma.Decimal(50000),
          hra: new Prisma.Decimal(10000),
          specialAllowance: new Prisma.Decimal(0),
          otherAllowances: null,
          ctcAnnual: new Prisma.Decimal(720000),
        },
      ]);

      const result = await service.getHistory('emp-1');
      expect(prisma.salaryStructure.findMany).toHaveBeenCalledWith({
        where: { employeeId: 'emp-1' },
        orderBy: { effectiveFrom: 'desc' },
      });
      expect(result.map((r) => r.id)).toEqual(['row-2', 'row-1']);
    });
  });
});
