import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../core/database/prisma.service';
import {
  PaginatedResult,
  PaginationQueryDto,
} from '../../common/dto/pagination.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserEntity } from './entities/user.entity';

type UserWithRoles = Prisma.UserGetPayload<{ include: { roles: true } }>;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateUserDto): Promise<UserEntity> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        roles: dto.roles?.length
          ? { connect: dto.roles.map((name) => ({ name })) }
          : undefined,
      },
      include: { roles: true },
    });

    return this.toEntity(user);
  }

  async findAll(
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<UserEntity>> {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        include: { roles: true },
      }),
      this.prisma.user.count(),
    ]);

    return {
      items: items.map((u) => this.toEntity(u)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async findOne(id: string): Promise<UserEntity> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { roles: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return this.toEntity(user);
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserEntity> {
    await this.findOne(id); // 404 if missing

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        roles: dto.roles
          ? { set: dto.roles.map((name) => ({ name })) }
          : undefined,
      },
      include: { roles: true },
    });

    return this.toEntity(user);
  }

  async remove(id: string): Promise<UserEntity> {
    await this.findOne(id); // 404 if missing
    const user = await this.prisma.user.delete({
      where: { id },
      include: { roles: true },
    });
    return this.toEntity(user);
  }

  private toEntity(user: UserWithRoles): UserEntity {
    return new UserEntity({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      isActive: user.isActive,
      roles: user.roles.map((r) => r.name),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  }
}
