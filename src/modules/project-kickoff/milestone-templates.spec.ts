import { NotFoundException } from '@nestjs/common';
import { OrderLineDeliveryType } from '@prisma/client';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ProjectKickoffService } from './project-kickoff.service';
import { ProjectKickoffAccessService } from './project-kickoff-access.service';
import { PrismaService } from '../../core/database/prisma.service';

/**
 * Focused coverage for the kickoff milestone-template union/dedup logic, the
 * one non-trivial piece of the Milestone Templates feature. Prisma + the access
 * service are stubbed; only the pure shaping is exercised.
 */
const user = { id: 'u1', role: 'MANAGER' } as AuthenticatedUser;

function makeService(opts: {
  deliveryTypes: (OrderLineDeliveryType | null)[];
  templates: { flowType: OrderLineDeliveryType; name: string }[];
  kickoffExists?: boolean;
}) {
  const findMany = jest.fn().mockResolvedValue(opts.templates);
  const prisma = {
    projectKickoff: {
      findUnique: jest.fn().mockResolvedValue(
        opts.kickoffExists === false
          ? null
          : {
              order: {
                // Delivery types now live on per-vendor splits under each line.
                lineItems: opts.deliveryTypes.map((deliveryType) => ({
                  deliverySplits: [{ deliveryType }],
                })),
              },
            },
      ),
    },
    milestoneTemplate: { findMany },
  } as unknown as PrismaService;
  const access = {
    assertCanAccess: jest.fn().mockResolvedValue(undefined),
  } as unknown as ProjectKickoffAccessService;
  const service = new ProjectKickoffService(
    prisma,
    access,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, findMany, access };
}

describe('ProjectKickoffService.milestoneTemplates', () => {
  it('returns the union of templates for the kickoff line delivery types, deduped by name', async () => {
    const { service, findMany } = makeService({
      deliveryTypes: ['NPD', 'IN_HOUSE', 'IN_HOUSE'],
      // Pre-sorted by displayOrder, as the query returns them.
      templates: [
        { flowType: 'NPD', name: 'Design Concept Finalisation' },
        { flowType: 'IN_HOUSE', name: 'Material Ready' },
        { flowType: 'NPD', name: 'Material Ready' },
        { flowType: 'IN_HOUSE', name: 'QC Sign-off' },
        { flowType: 'NPD', name: 'QC Sign-off' },
      ],
    });

    const result = await service.milestoneTemplates('k1', user);

    // Deduped by name.
    expect(result.map((r) => r.name)).toEqual([
      'Design Concept Finalisation',
      'Material Ready',
      'QC Sign-off',
    ]);
    // Records every flow type that contributed a shared name.
    const materialReady = result.find((r) => r.name === 'Material Ready');
    expect(materialReady?.flowTypes.sort()).toEqual(['IN_HOUSE', 'NPD']);

    // Queried only the DISTINCT delivery types actually present.
    const where = findMany.mock.calls[0][0].where;
    expect(where.isActive).toBe(true);
    expect([...where.flowType.in].sort()).toEqual(['IN_HOUSE', 'NPD']);
  });

  it('returns [] and skips the template query when no line has a delivery type', async () => {
    const { service, findMany } = makeService({
      deliveryTypes: [null, null],
      templates: [],
    });

    const result = await service.milestoneTemplates('k1', user);

    expect(result).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('throws when the kickoff does not exist', async () => {
    const { service } = makeService({
      deliveryTypes: [],
      templates: [],
      kickoffExists: false,
    });

    await expect(
      service.milestoneTemplates('missing', user),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
