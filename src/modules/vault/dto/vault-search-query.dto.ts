import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Vault browse/discovery query params (search + filter + sort). Every filter
 * dimension here maps to a field Vault actually captures today — filename,
 * folder name, uploader, upload date, mimetype/extension — plus origin, which
 * is DERIVED from module back-relations and module-owned folder identity (there
 * is no stored source-module column; see vault-search.ts).
 */

/** Which slice of the tree a search runs over. */
export enum VaultSearchScope {
  /** The current folder AND everything nested beneath it. */
  FOLDER = 'FOLDER',
  /** Every folder the caller can read. */
  VAULT = 'VAULT',
}

/** File-type buckets for the type filter, derived from extension + mimetype. */
export enum VaultFileTypeCategory {
  PDF = 'PDF',
  IMAGE = 'IMAGE',
  SPREADSHEET = 'SPREADSHEET',
  DOCUMENT = 'DOCUMENT',
  PRESENTATION = 'PRESENTATION',
  CAD = 'CAD',
  ARCHIVE = 'ARCHIVE',
  TEXT = 'TEXT',
  OTHER = 'OTHER',
}

/** Which module filed a document (derived, never stored). */
export enum VaultFileOrigin {
  DESIGN = 'DESIGN',
  SALES_LEAD = 'SALES_LEAD',
  VENDOR_QUALIFICATION = 'VENDOR_QUALIFICATION',
  RFQ = 'RFQ',
  /** Uploaded by a person through the Vault UI — not auto-filed by a module. */
  MANUAL = 'MANUAL',
}

/** Standard drive sorting. RELEVANCE is only meaningful with a search term. */
export enum VaultSortOption {
  RELEVANCE = 'RELEVANCE',
  NAME_ASC = 'NAME_ASC',
  NAME_DESC = 'NAME_DESC',
  MODIFIED_DESC = 'MODIFIED_DESC',
  MODIFIED_ASC = 'MODIFIED_ASC',
  SIZE_DESC = 'SIZE_DESC',
  SIZE_ASC = 'SIZE_ASC',
  TYPE_ASC = 'TYPE_ASC',
}

/** Filters + sort, shared by folder listing and search. */
export class VaultBrowseQueryDto {
  @ApiPropertyOptional({
    enum: VaultFileTypeCategory,
    description: 'Keep only files in this type bucket',
  })
  @IsOptional()
  @IsEnum(VaultFileTypeCategory)
  fileType?: VaultFileTypeCategory;

  @ApiPropertyOptional({
    description: 'Keep only files uploaded by this employee',
  })
  @IsOptional()
  @IsUUID()
  uploadedById?: string;

  @ApiPropertyOptional({
    description: 'Upload date range start (inclusive, ISO-8601)',
  })
  @IsOptional()
  @IsISO8601()
  uploadedFrom?: string;

  @ApiPropertyOptional({
    description: 'Upload date range end (inclusive to end-of-day, ISO-8601)',
  })
  @IsOptional()
  @IsISO8601()
  uploadedTo?: string;

  @ApiPropertyOptional({
    enum: VaultFileOrigin,
    description:
      'Keep only files filed by this module (MANUAL = uploaded by a person)',
  })
  @IsOptional()
  @IsEnum(VaultFileOrigin)
  origin?: VaultFileOrigin;

  @ApiPropertyOptional({ enum: VaultSortOption })
  @IsOptional()
  @IsEnum(VaultSortOption)
  sort?: VaultSortOption;
}

/** Search query: the browse filters plus a fuzzy term and an explicit scope. */
export class VaultSearchQueryDto extends VaultBrowseQueryDto {
  @ApiPropertyOptional({
    description:
      'Fuzzy term matched against file names and folder names. Omit to browse with filters only.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({
    enum: VaultSearchScope,
    default: VaultSearchScope.VAULT,
    description:
      'FOLDER searches the given folder and everything nested beneath it; VAULT searches every folder the caller can read.',
  })
  @IsOptional()
  @IsEnum(VaultSearchScope)
  scope: VaultSearchScope = VaultSearchScope.VAULT;

  @ApiPropertyOptional({
    description: 'Required when scope=FOLDER — the folder to search within',
  })
  @IsOptional()
  @IsUUID()
  folderId?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 50;
}

/** Recent-files query: how many of the caller's latest documents to return. */
export class VaultRecentQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 12 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 12;
}
