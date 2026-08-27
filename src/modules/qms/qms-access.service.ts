import { ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
@Injectable()
export class QmsAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async accessFor(user: AuthenticatedUser) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: user.id },
      select: {
        status: true,
        isQcInspector: true,
        isQmsHead: true,
        vertical: {
          select: {
            code: true,
            name: true,
          },
        },
      },
    });

    const isActive = employee?.status === 'ACTIVE';
    const isQualityVertical =
      employee?.vertical?.code.trim().toUpperCase() === 'QUALITY' ||
      employee?.vertical?.name.trim().toLowerCase() === 'quality';

    return {
      isQualityUser:
        isActive &&
        Boolean(
          isQualityVertical ||
          employee?.isQcInspector ||
          employee?.isQmsHead ||
          user.role === Role.SUPER_ADMIN,
        ),
      // Approval authority remains an explicit single-holder capability.
      isQmsHead: Boolean(isActive && employee?.isQmsHead),
    };
  }

  async assertUser(user: AuthenticatedUser) {
    const access = await this.accessFor(user);
    if (!access.isQualityUser) {
      throw new ForbiddenException(
        'QMS access requires an active Quality vertical assignment, Quality Inspector, or QMS Head capability',
      );
    }
  }

  async assertHead(user: AuthenticatedUser) {
    const access = await this.accessFor(user);
    if (!access.isQmsHead) {
      throw new ForbiddenException(
        'Only the designated QMS Head may approve quality records',
      );
    }
  }
}
