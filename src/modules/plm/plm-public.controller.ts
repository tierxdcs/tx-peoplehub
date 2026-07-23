import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import {
  PlmPhotoUploadUrlDto,
  PlmProductionUpdateDto,
  PlmPublicResolveDto,
} from './dto/plm.dto';
import { PlmVendorUpdateService } from './plm-vendor-update.service';

@ApiTags('plm-public')
@Controller('public/plm-vendor-update')
export class PlmPublicController {
  constructor(private readonly service: PlmVendorUpdateService) {}

  @Public()
  @Post(':token/resolve')
  @ApiOperation({ summary: 'Resolve a vendor production-update link' })
  resolve(@Param('token') token: string, @Body() dto: PlmPublicResolveDto) {
    return this.service.resolvePublic(token, dto.password);
  }

  @Public()
  @Post(':token/photo-upload-url')
  @ApiOperation({ summary: 'Presign a guarded vendor progress-photo upload' })
  photoUploadUrl(
    @Param('token') token: string,
    @Body() dto: PlmPhotoUploadUrlDto,
  ) {
    return this.service.publicPhotoUploadUrl(token, dto);
  }

  @Public()
  @Post(':token/submit')
  @ApiOperation({ summary: 'Submit an attributed vendor production update' })
  submit(
    @Param('token') token: string,
    @Body() dto: PlmProductionUpdateDto,
  ) {
    return this.service.submitPublic(token, dto);
  }
}
