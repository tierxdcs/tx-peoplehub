import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { CreateVerticalDto } from './dto/create-vertical.dto';
import { VerticalEntity } from './entities/vertical.entity';

@Injectable()
export class VerticalsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateVerticalDto): Promise<VerticalEntity> {
    const existing = await this.prisma.vertical.findFirst({
      where: { OR: [{ name: dto.name }, { code: dto.code }] },
    });
    if (existing) {
      throw new ConflictException('Vertical name or code already in use');
    }

    const vertical = await this.prisma.vertical.create({
      data: {
        name: dto.name,
        code: dto.code,
        isActive: dto.isActive ?? true,
      },
    });

    return new VerticalEntity(vertical);
  }

  async findAll(): Promise<VerticalEntity[]> {
    const verticals = await this.prisma.vertical.findMany({
      orderBy: { name: 'asc' },
    });
    return verticals.map((v) => new VerticalEntity(v));
  }

  /**
   * The full vertical list is readable by Admin/SuperAdmin and by HR-vertical
   * staff — HR onboarding lets HR create employees into ANY vertical, so the
   * onboarding/roster screens genuinely need every vertical (a plain
   * role-based @Roles guard can't express "or HR-vertical", so it's enforced
   * here, same pattern as EmployeesService.isHrStaff). Everyone else is
   * denied; they can still read their own vertical via findMine().
   */
  async assertCanListAll(user: AuthenticatedUser): Promise<void> {
    if (user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN) {
      return;
    }
    const isHrStaff =
      (user.role === Role.MANAGER || user.role === Role.EMPLOYEE) &&
      !!user.verticalId &&
      (
        await this.prisma.vertical.findUnique({
          where: { id: user.verticalId },
        })
      )?.code === 'HR';
    if (!isHrStaff) {
      throw new ForbiddenException(
        'Only Admins or HR-vertical staff may list all verticals',
      );
    }
  }

  /**
   * The caller's own vertical, or null if they have none (e.g. SUPER_ADMIN).
   * Lets any authenticated employee resolve their own vertical code for
   * client-side nav gating without exposing the full ADMIN-only list.
   */
  async findMine(verticalId: string | null): Promise<VerticalEntity | null> {
    if (!verticalId) {
      return null;
    }
    const vertical = await this.prisma.vertical.findUnique({
      where: { id: verticalId },
    });
    return vertical ? new VerticalEntity(vertical) : null;
  }
}
