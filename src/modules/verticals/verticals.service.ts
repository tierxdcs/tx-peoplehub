import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service';
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
}
