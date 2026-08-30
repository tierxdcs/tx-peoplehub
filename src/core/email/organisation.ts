import { PrismaService } from '../database/prisma.service';

/**
 * Our own name as recipients should see it. Read from the finance company
 * settings row — the same legal name that already appears on invoices — so an
 * outgoing email and an invoice never disagree, and nothing has to be
 * configured twice.
 */

/** Used only before finance settings are seeded (fresh dev DB). */
export const DEFAULT_ORGANISATION_NAME = 'Phaze Dynamics';

export async function resolveOrganisationName(
  prisma: PrismaService,
): Promise<string> {
  const settings = await prisma.financeCompanySettings.findFirst({
    select: { legalName: true },
  });
  return settings?.legalName?.trim() || DEFAULT_ORGANISATION_NAME;
}
