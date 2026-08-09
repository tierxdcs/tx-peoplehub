import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  CreateLearningCourseDto,
  UpdateLearningCourseDto,
  UpdateLearningProgressDto,
} from './dto/learning.dto';
import { LearningService } from './learning.service';

@ApiTags('learning')
@ApiBearerAuth()
@Controller('learning')
@Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
export class LearningController {
  constructor(private readonly service: LearningService) {}
  @Get('courses') list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user);
  }
  @Post('courses') create(
    @Body() dto: CreateLearningCourseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(dto, user);
  }
  @Patch('courses/:id') update(
    @Param('id') id: string,
    @Body() dto: UpdateLearningCourseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, dto, user);
  }
  @Post('courses/:id/publish') publish(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.publish(id, user);
  }
  @Patch('courses/:id/progress') progress(
    @Param('id') id: string,
    @Body() dto: UpdateLearningProgressDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.saveProgress(id, dto, user);
  }
}
