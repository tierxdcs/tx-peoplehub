import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service';
import { UsersService } from './users.service';

/**
 * Unit test for UsersService with a mocked PrismaService. Demonstrates the
 * testing pattern future ERP module services should follow.
 */
describe('UsersService', () => {
  let service: UsersService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  const dbUser = {
    id: 'u1',
    email: 'jane@peoplehub.local',
    passwordHash: 'hash',
    firstName: 'Jane',
    lastName: 'Doe',
    isActive: true,
    roles: [{ name: 'user' }],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(UsersService);
  });

  describe('create', () => {
    it('creates a user and returns an entity without passwordHash', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(dbUser);

      const result = await service.create({
        email: dbUser.email,
        password: 'S3curePass!',
      });

      expect(result.id).toBe('u1');
      expect(result.roles).toEqual(['user']);
      expect((result as any).passwordHash).toBeUndefined();
      expect(prisma.user.create).toHaveBeenCalled();
    });

    it('throws ConflictException when email is taken', async () => {
      prisma.user.findUnique.mockResolvedValue(dbUser);

      await expect(
        service.create({ email: dbUser.email, password: 'S3curePass!' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('findAll', () => {
    it('returns a paginated result', async () => {
      prisma.$transaction.mockResolvedValue([[dbUser], 1]);

      const result = await service.findAll({
        page: 1,
        limit: 20,
        skip: 0,
      } as any);

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].email).toBe(dbUser.email);
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when missing', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.findOne('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
