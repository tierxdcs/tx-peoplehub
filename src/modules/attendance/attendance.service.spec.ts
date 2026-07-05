import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../core/database/prisma.service';
import { AttendanceService } from './attendance.service';

describe('AttendanceService', () => {
  let service: AttendanceService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      attendance: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        upsert: jest.fn(),
      },
      leaveRequest: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttendanceService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('Asia/Kolkata') },
        },
      ],
    }).compile();

    service = module.get(AttendanceService);
  });

  describe('checkIn', () => {
    it('creates a new record with checkInTime when none exists today', async () => {
      prisma.attendance.findUnique.mockResolvedValue(null);
      prisma.attendance.create.mockResolvedValue({
        id: 'a1',
        employeeId: 'emp-1',
        date: new Date(),
        checkInTime: new Date(),
        checkOutTime: null,
      });

      const result = await service.checkIn('emp-1');
      expect(result.status).toBe('PRESENT'); // today, check-in only -> optimistic PRESENT
      expect(prisma.attendance.create).toHaveBeenCalled();
    });

    it('rejects a second check-in on the same day', async () => {
      prisma.attendance.findUnique.mockResolvedValue({
        id: 'a1',
        checkInTime: new Date(),
        checkOutTime: null,
      });

      await expect(service.checkIn('emp-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('checkOut', () => {
    it('rejects check-out before check-in', async () => {
      prisma.attendance.findUnique.mockResolvedValue(null);

      await expect(service.checkOut('emp-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects a second check-out on the same day', async () => {
      prisma.attendance.findUnique.mockResolvedValue({
        id: 'a1',
        checkInTime: new Date(),
        checkOutTime: new Date(),
      });

      await expect(service.checkOut('emp-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('succeeds when checked in but not yet checked out', async () => {
      prisma.attendance.findUnique.mockResolvedValue({
        id: 'a1',
        checkInTime: new Date(),
        checkOutTime: null,
      });
      prisma.attendance.update.mockResolvedValue({
        id: 'a1',
        employeeId: 'emp-1',
        date: new Date(),
        checkInTime: new Date(),
        checkOutTime: new Date(),
      });

      const result = await service.checkOut('emp-1');
      expect(result.status).toBe('PRESENT');
    });
  });

  describe('status derivation (via getOwn)', () => {
    async function statusFor(record: {
      date: Date;
      checkInTime: Date | null;
      checkOutTime: Date | null;
    }) {
      prisma.$transaction.mockResolvedValue([
        [{ id: 'a1', employeeId: 'emp-1', ...record }],
        1,
      ]);
      const result = await service.getOwn('emp-1', {
        page: 1,
        limit: 20,
        skip: 0,
      } as any);
      return result.items[0].status;
    }

    it('ON_LEAVE takes priority over any check-in/out state', async () => {
      const date = new Date('2026-01-05T00:00:00.000Z');
      prisma.leaveRequest.findMany.mockResolvedValue([
        {
          employeeId: 'emp-1',
          startDate: new Date('2026-01-01T00:00:00.000Z'),
          endDate: new Date('2026-01-10T00:00:00.000Z'),
        },
      ]);
      const status = await statusFor({
        date,
        checkInTime: new Date(),
        checkOutTime: new Date(),
      });
      expect(status).toBe('ON_LEAVE');
    });

    it('PRESENT when both check-in and check-out exist', async () => {
      const status = await statusFor({
        date: new Date('2026-01-05T00:00:00.000Z'),
        checkInTime: new Date(),
        checkOutTime: new Date(),
      });
      expect(status).toBe('PRESENT');
    });

    it('HALF_DAY when only check-in exists on a past day', async () => {
      const status = await statusFor({
        date: new Date('2020-01-05T00:00:00.000Z'),
        checkInTime: new Date(),
        checkOutTime: null,
      });
      expect(status).toBe('HALF_DAY');
    });

    it('HALF_DAY when only check-out exists', async () => {
      const status = await statusFor({
        date: new Date('2020-01-05T00:00:00.000Z'),
        checkInTime: null,
        checkOutTime: new Date(),
      });
      expect(status).toBe('HALF_DAY');
    });

    it('ABSENT when neither check-in nor check-out nor approved leave exists', async () => {
      const status = await statusFor({
        date: new Date('2020-01-05T00:00:00.000Z'),
        checkInTime: null,
        checkOutTime: null,
      });
      expect(status).toBe('ABSENT');
    });
  });

  describe('correct', () => {
    it('upserts times directly without ever setting status', async () => {
      prisma.attendance.upsert.mockResolvedValue({
        id: 'a1',
        employeeId: 'emp-1',
        date: new Date('2026-01-05T00:00:00.000Z'),
        checkInTime: new Date('2026-01-05T09:00:00.000Z'),
        checkOutTime: new Date('2026-01-05T18:00:00.000Z'),
      });

      const result = await service.correct('emp-1', '2026-01-05', {
        checkInTime: '2026-01-05T09:00:00.000Z',
        checkOutTime: '2026-01-05T18:00:00.000Z',
      });

      expect(prisma.attendance.upsert).toHaveBeenCalled();
      const call = prisma.attendance.upsert.mock.calls[0][0];
      expect(call.update).not.toHaveProperty('status');
      expect(call.create).not.toHaveProperty('status');
      expect(result.status).toBe('PRESENT'); // derived, not passed in
    });

    it('reflects ON_LEAVE when the corrected date falls within approved leave', async () => {
      prisma.attendance.upsert.mockResolvedValue({
        id: 'a1',
        employeeId: 'emp-1',
        date: new Date('2026-08-11T00:00:00.000Z'),
        checkInTime: new Date('2026-08-11T09:00:00.000Z'),
        checkOutTime: null,
      });
      prisma.leaveRequest.findMany.mockResolvedValue([
        {
          employeeId: 'emp-1',
          startDate: new Date('2026-08-10T00:00:00.000Z'),
          endDate: new Date('2026-08-12T00:00:00.000Z'),
        },
      ]);

      const result = await service.correct('emp-1', '2026-08-11', {
        checkInTime: '2026-08-11T09:00:00.000Z',
      });

      // Regression: correct() must run the same leave-lookup as
      // getOwn/getForEmployees, not just derive from times in isolation —
      // otherwise the response from correct() disagrees with a subsequent
      // getOne()/getOwn() read of the identical record.
      expect(result.status).toBe('ON_LEAVE');
    });
  });

  describe('getOne', () => {
    it('returns null when no record exists for that employee/date', async () => {
      prisma.attendance.findUnique.mockResolvedValue(null);

      const result = await service.getOne('emp-1', '2026-01-05');
      expect(result).toBeNull();
    });

    it('returns the derived entity when a record exists', async () => {
      prisma.attendance.findUnique.mockResolvedValue({
        id: 'a1',
        employeeId: 'emp-1',
        date: new Date('2020-01-05T00:00:00.000Z'),
        checkInTime: new Date('2020-01-05T09:00:00.000Z'),
        checkOutTime: new Date('2020-01-05T18:00:00.000Z'),
      });

      const result = await service.getOne('emp-1', '2020-01-05');
      expect(result?.status).toBe('PRESENT');
    });
  });

  describe('getForEmployees', () => {
    it('returns an empty array without querying when given no ids', async () => {
      const result = await service.getForEmployees([], new Date(), new Date());
      expect(result).toEqual([]);
      expect(prisma.attendance.findMany).not.toHaveBeenCalled();
    });
  });
});
