import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service';
import { BusinessUnitEntity } from './entities/business-unit.entity';
import { CreateBusinessUnitDto } from './dto/create-business-unit.dto';
import { UpdateBusinessUnitDto } from './dto/update-business-unit.dto';

@Injectable()
export class BusinessUnitsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateBusinessUnitDto): Promise<BusinessUnitEntity> {
    const existing = await this.prisma.businessUnit.findFirst({
      where: { OR: [{ name: dto.name }, { code: dto.code }] },
    });
    if (existing) {
      throw new ConflictException('Business unit name or code already in use');
    }
    const bu = await this.prisma.businessUnit.create({
      data: {
        name: dto.name,
        code: dto.code,
        description: dto.description ?? null,
        isActive: dto.isActive ?? true,
        displayOrder: dto.displayOrder ?? 0,
        colorHex: dto.colorHex ?? '#2563EB',
      },
    });
    return new BusinessUnitEntity(bu);
  }

  /** All business units, ordered for management (displayOrder then name). */
  async findAll(): Promise<BusinessUnitEntity[]> {
    const units = await this.prisma.businessUnit.findMany({
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
    return units.map((u) => new BusinessUnitEntity(u));
  }

  /**
   * ACTIVE units only, for a picker — readable by any authenticated user (it's
   * reference data needed to populate the product form dropdown). A deactivated
   * unit is omitted here so it can't be chosen for a new product, while
   * remaining valid on products already tagged with it.
   */
  async findActiveOptions(): Promise<BusinessUnitEntity[]> {
    const units = await this.prisma.businessUnit.findMany({
      where: { isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
    return units.map((u) => new BusinessUnitEntity(u));
  }

  async update(
    id: string,
    dto: UpdateBusinessUnitDto,
  ): Promise<BusinessUnitEntity> {
    await this.findRawOrThrow(id);
    // Name stays unique. Guard a rename collision (code is immutable here).
    if (dto.name !== undefined) {
      const clash = await this.prisma.businessUnit.findFirst({
        where: { name: dto.name, id: { not: id } },
        select: { id: true },
      });
      if (clash) throw new ConflictException('Business unit name already in use');
    }
    const bu = await this.prisma.businessUnit.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.displayOrder !== undefined
          ? { displayOrder: dto.displayOrder }
          : {}),
        ...(dto.colorHex !== undefined ? { colorHex: dto.colorHex } : {}),
      },
    });
    return new BusinessUnitEntity(bu);
  }

  private async findRawOrThrow(id: string) {
    const bu = await this.prisma.businessUnit.findUnique({ where: { id } });
    if (!bu) throw new NotFoundException('Business unit not found');
    return bu;
  }
}
