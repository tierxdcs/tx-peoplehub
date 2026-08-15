import { ApiPropertyOptional } from '@nestjs/swagger';
import { OrderType } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

/** Order list query: pagination plus an optional order-type filter. */
export class ListOrdersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: OrderType,
    description:
      'Filter by order type. INTERNAL is used to list promotable internal orders.',
  })
  @IsOptional()
  @IsEnum(OrderType)
  orderType?: OrderType;
}
