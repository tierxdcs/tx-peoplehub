import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import {
  PushTestDto,
  RegisterPushSubscriptionDto,
  UnsubscribePushQueryDto,
} from './dto/push-subscription.dto';
import {
  PushConfigEntity,
  PushDeviceEntity,
} from './entities/push-device.entity';
import { PushSubscriptionsService } from './push-subscriptions.service';

/**
 * The caller's own push notification devices. No @Roles decorator and no access
 * service: every route reads or writes only the authenticated employee's own
 * subscriptions, so a valid token is the whole authorization story (the same
 * reasoning as the nav-shortcuts controller).
 *
 * Nothing here decides *when* a notification is sent — that is a later phase.
 * These routes only let a device opt in, list itself, opt out, and prove that
 * delivery works.
 */
@ApiTags('push')
@ApiBearerAuth()
@Controller('push')
export class PushController {
  constructor(private readonly subscriptions: PushSubscriptionsService) {}

  @Get('config')
  @ApiOperation({
    summary: 'VAPID public key + whether push is configured on this server',
    description:
      'The client needs the public key to call PushManager.subscribe(). It is not a secret. The private key is never returned by any route.',
  })
  @ApiOkResponse({ type: PushConfigEntity })
  config() {
    return this.subscriptions.config();
  }

  @Get('devices')
  @ApiOperation({ summary: "List the caller's subscribed devices" })
  @ApiOkResponse({ type: [PushDeviceEntity] })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.subscriptions.list(user);
  }

  @Post('subscriptions')
  @ApiOperation({
    summary: 'Register this browser for push notifications',
    description:
      'Idempotent — safe to call on every page load, which is how a rotated subscription heals itself.',
  })
  @ApiOkResponse({ type: PushDeviceEntity })
  register(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterPushSubscriptionDto,
  ) {
    return this.subscriptions.register(user, dto);
  }

  @Delete('subscriptions')
  @ApiOperation({
    summary: 'Turn notifications off for this browser',
    description: 'Unsubscribing something already gone is a no-op.',
  })
  @ApiOkResponse({ type: [PushDeviceEntity] })
  unsubscribe(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: UnsubscribePushQueryDto,
  ) {
    return this.subscriptions.unsubscribe(user, query.endpoint);
  }

  @Delete('subscriptions/:id')
  @ApiOperation({
    summary: 'Revoke one listed device (e.g. a phone you no longer have)',
  })
  @ApiOkResponse({ type: [PushDeviceEntity] })
  revoke(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.subscriptions.revoke(user, id);
  }

  @Post('test')
  @ApiOperation({
    summary: "Send a test notification to the caller's own devices",
    description:
      'The only honest end-to-end check: a 200 here means the push service accepted the message, but the notification appearing on the phone is the proof.',
  })
  test(@CurrentUser() user: AuthenticatedUser, @Body() dto: PushTestDto) {
    return this.subscriptions.sendTest(user, dto.note);
  }
}
