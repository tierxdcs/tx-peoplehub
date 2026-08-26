import { describe, expect, it } from 'vitest';
import { isCrossVerticalApprovalRoute } from './hr-route-access';
import type { DecodedAccessToken } from './jwt';
import { sharedNav, type Access } from './nav';

/** A non-HR Manager — a vertical owner who must still reach their inboxes. */
function nonHrManager(): Access {
  const user: DecodedAccessToken = {
    sub: 'u1',
    email: 'owner@x.com',
    role: 'MANAGER',
    verticalId: 'v1',
  };
  return {
    user,
    isHrStaff: false,
    isSalesStaff: false,
    isSalesHead: false,
    isRndHead: false,
    isRndStaff: false,
    isStoreStaff: false,
    isScmStaff: false,
    isFinanceUser: false,
    isAccountsHead: false,
    offerLetterApprovalsPending: true,
    payslipsEnabled: false,
  };
}

describe('isCrossVerticalApprovalRoute', () => {
  it('admits the offer-letter approval queue and its review pages', () => {
    expect(
      isCrossVerticalApprovalRoute('/hr/offer-letters/pending-approval'),
    ).toBe(true);
    expect(
      isCrossVerticalApprovalRoute('/hr/offer-letters/pending-approval/abc-1'),
    ).toBe(true);
  });

  it('still gates the HR-only offer-letter register', () => {
    expect(isCrossVerticalApprovalRoute('/hr/offer-letters')).toBe(false);
    expect(isCrossVerticalApprovalRoute('/hr/roster')).toBe(false);
    expect(isCrossVerticalApprovalRoute('/hr/onboard')).toBe(false);
  });

  it('does not admit a sibling path that merely shares a prefix string', () => {
    expect(
      isCrossVerticalApprovalRoute('/hr/offer-letters/pending-approvals-old'),
    ).toBe(false);
  });

  // The original bug: the shared "Approvals" nav offered a non-HR Manager a
  // link the /hr gate then bounced to /team ("My Team"). Every /hr/* link the
  // shared nav shows must be reachable by whoever it is shown to.
  it('admits every /hr/* link the shared nav gives a non-HR manager', () => {
    const hrLinks = sharedNav(nonHrManager())
      .flatMap((g) => g.items.map((i) => i.href))
      .filter((href) => href.startsWith('/hr/'));

    expect(hrLinks.length).toBeGreaterThan(0);
    for (const href of hrLinks) {
      expect(isCrossVerticalApprovalRoute(href), href).toBe(true);
    }
  });
});
