import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { SalaryStructuresService } from './salary-structures.service';
import { OnboardingCompensationService } from './onboarding-compensation.service';

describe('SalaryStructuresService', () => {
  let service: SalaryStructuresService;
  let prisma: any;
  let onboardingCompensation: { calculate: jest.Mock };

  beforeEach(async () => {
    prisma = {
      employee: { findUnique: jest.fn() },
      salaryStructure: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
    };
    onboardingCompensation = { calculate: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalaryStructuresService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: OnboardingCompensationService,
          useValue: onboardingCompensation,
        },
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

    it('persists variablePay and surfaces it on the entity (annual indirect component)', async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: 'emp-1' });
      prisma.salaryStructure.create.mockResolvedValue({
        id: 'new-row',
        employeeId: 'emp-1',
        effectiveFrom: new Date('2026-06-01'),
        basic: new Prisma.Decimal(50000),
        hra: new Prisma.Decimal(10000),
        specialAllowance: new Prisma.Decimal(8000),
        otherAllowances: null,
        variablePay: new Prisma.Decimal(60000),
        ctcAnnual: new Prisma.Decimal(876000),
      });

      const result = await service.create(
        {
          employeeId: 'emp-1',
          effectiveFrom: '2026-06-01',
          basic: 50000,
          hra: 10000,
          specialAllowance: 8000,
          variablePay: 60000,
          ctcAnnual: 876000,
        },
        'admin-1',
      );

      expect(prisma.salaryStructure.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ variablePay: 60000 }),
        }),
      );
      expect(result.variablePay).toBe('60000');
    });

    it('stores variablePay as null when omitted', async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: 'emp-1' });
      prisma.salaryStructure.create.mockResolvedValue({
        id: 'new-row',
        employeeId: 'emp-1',
        effectiveFrom: new Date('2026-06-01'),
        basic: new Prisma.Decimal(50000),
        hra: new Prisma.Decimal(10000),
        specialAllowance: new Prisma.Decimal(0),
        otherAllowances: null,
        variablePay: null,
        ctcAnnual: new Prisma.Decimal(720000),
      });

      const result = await service.create(
        {
          employeeId: 'emp-1',
          effectiveFrom: '2026-06-01',
          basic: 50000,
          hra: 10000,
          ctcAnnual: 720000,
        },
        'admin-1',
      );

      expect(prisma.salaryStructure.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ variablePay: null }),
        }),
      );
      expect(result.variablePay).toBeNull();
    });
  });

  describe('createFromCtc', () => {
    it('throws NotFoundException for a non-existent employee', async () => {
      prisma.employee.findUnique.mockResolvedValue(null);

      await expect(
        service.createFromCtc(
          {
            employeeId: 'nope',
            monthlyCtc: 100000,
            effectiveDate: '2026-09-01',
          },
          'admin-1',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(onboardingCompensation.calculate).not.toHaveBeenCalled();
    });

    it('reverse-solves the CTC and maps conveyance→special, incentive→variable into a new row', async () => {
      prisma.employee.findUnique.mockResolvedValue({ id: 'emp-1' });
      onboardingCompensation.calculate.mockResolvedValue({
        basicMonthly: '53975.08',
        hraMonthly: '28786.71',
        conveyanceMonthly: '500.00',
        otherAllowanceMonthly: '6696.67',
        incentiveAnnual: '89958.46',
        annualCtc: '1200000.00',
      });
      prisma.salaryStructure.create.mockImplementation(({ data }: any) => ({
        id: 'hike-row',
        ...data,
        basic: new Prisma.Decimal(data.basic),
        hra: new Prisma.Decimal(data.hra),
        specialAllowance: new Prisma.Decimal(data.specialAllowance),
        otherAllowances: new Prisma.Decimal(data.otherAllowances),
        variablePay: new Prisma.Decimal(data.variablePay),
        ctcAnnual: new Prisma.Decimal(data.ctcAnnual),
      }));

      const result = await service.createFromCtc(
        {
          employeeId: 'emp-1',
          monthlyCtc: 100000,
          effectiveDate: '2026-09-01',
        },
        'admin-1',
      );

      expect(onboardingCompensation.calculate).toHaveBeenCalledWith(
        100000,
        new Date('2026-09-01'),
      );
      expect(prisma.salaryStructure.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            employeeId: 'emp-1',
            effectiveFrom: new Date('2026-09-01'),
            basic: '53975.08',
            hra: '28786.71',
            specialAllowance: '500.00', // conveyance lands in the Special slot
            otherAllowances: '6696.67',
            variablePay: '89958.46', // annual incentive
            ctcAnnual: '1200000.00',
            createdById: 'admin-1',
          }),
        }),
      );
      expect(result.id).toBe('hike-row');
      expect(result.ctcAnnual).toBe('1200000');
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
