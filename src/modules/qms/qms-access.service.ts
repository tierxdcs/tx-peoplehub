import { ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
@Injectable()
export class QmsAccessService {
  constructor(private readonly prisma:PrismaService){}
  async accessFor(u:AuthenticatedUser){ const e=await this.prisma.employee.findUnique({where:{id:u.id},select:{status:true,isQcInspector:true,isQmsHead:true}}); return {isQualityUser:e?.status==='ACTIVE'&&(e.isQcInspector||e.isQmsHead||u.role===Role.SUPER_ADMIN),isQmsHead:e?.status==='ACTIVE'&&e.isQmsHead}; }
  async assertUser(u:AuthenticatedUser){const a=await this.accessFor(u);if(!a.isQualityUser)throw new ForbiddenException('QMS access requires Quality Inspector or QMS Head capability');}
  async assertHead(u:AuthenticatedUser){const a=await this.accessFor(u);if(!a.isQmsHead)throw new ForbiddenException('Only the designated QMS Head may approve quality records');}
}
