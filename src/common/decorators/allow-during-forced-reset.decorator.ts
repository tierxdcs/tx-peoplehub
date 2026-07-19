import { SetMetadata } from '@nestjs/common';

export const ALLOW_DURING_FORCED_RESET_KEY = 'allowDuringForcedReset';

/**
 * Marks a route as reachable even while the user's `mustChangePassword` flag is
 * set. Only the endpoints needed to RESOLVE a forced reset (change your own
 * password, log out) should carry this — everything else is blocked by the
 * MustChangePasswordGuard until the password is changed.
 */
export const AllowDuringForcedReset = () =>
  SetMetadata(ALLOW_DURING_FORCED_RESET_KEY, true);
