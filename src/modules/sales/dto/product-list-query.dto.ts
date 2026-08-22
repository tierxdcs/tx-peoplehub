import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class ProductListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Search across SKU and product name' })
  @IsOptional()
  @IsString()
  search?: string;
}
