import { SetMetadata } from '@nestjs/common';

export const NO_AUDIT_KEY = 'noAudit';

/** Opt a mutating route out of the AuditInterceptor. */
export const NoAudit = () => SetMetadata(NO_AUDIT_KEY, true);
