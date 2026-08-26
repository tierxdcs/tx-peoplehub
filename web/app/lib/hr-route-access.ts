/**
 * Routes that live under /hr/* for URL grouping but are NOT HR-function pages:
 * approval inboxes routed to whichever vertical owner (in any vertical) a
 * requisition / provisioning request / offer letter belongs to. They surface in
 * the shared "Approvals" nav for everyone, self-guard each section, and are
 * backed by identity-checked endpoints — so the HR-only gate in the /hr layout
 * must not apply to them, or it bounces a non-HR Manager owner to their role
 * home (/team, "My Team") the moment they click their own inbox link.
 *
 * Keep this in sync with the /hr/* links emitted by `sharedNav` in ./nav —
 * hr-route-access.test.ts fails if one drifts out of the other.
 */
const CROSS_VERTICAL_APPROVAL_PREFIXES = [
  '/hr/candidate-requisitions',
  '/hr/provisioning-approvals',
  // Only the approval queue and its review pages — NOT /hr/offer-letters
  // itself, which is the HR authoring register and stays HR-gated.
  '/hr/offer-letters/pending-approval',
];

/**
 * Whether this /hr/* path is a cross-vertical approval route any authenticated
 * user may reach. Matches the prefix exactly or as a path segment, so
 * `/hr/offer-letters/pending-approval/<id>` passes while `/hr/offer-letters`
 * does not.
 */
export function isCrossVerticalApprovalRoute(pathname: string): boolean {
  return CROSS_VERTICAL_APPROVAL_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
