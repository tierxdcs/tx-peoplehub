import { ApiProperty } from '@nestjs/swagger';
import { NotificationType } from '@prisma/client';

/** A generic in-app notification for the recipient. */
export class NotificationEntity {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: NotificationType }) type!: NotificationType;
  @ApiProperty({ nullable: true }) relatedCardId!: string | null;
  @ApiProperty() message!: string;
  @ApiProperty() isRead!: boolean;
  @ApiProperty() createdAt!: string;

  constructor(partial: Partial<NotificationEntity>) {
    Object.assign(this, partial);
  }
}
