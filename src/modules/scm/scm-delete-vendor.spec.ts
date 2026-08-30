import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ScmService } from './scm.service';

describe('ScmService vendor deletion', () => {
  const superAdmin = {
    id: 'admin-1',
    email: 'ceo@example.com',
    role: Role.SUPER_ADMIN,
    verticalId: null,
  };

  function setup(referenceCounts: Partial<Record<string, number>> = {}) {
    const count = (key: string) =>
      jest.fn().mockResolvedValue(referenceCounts[key] ?? 0);
    const tx = {
      orderLineItem: { count: count('orderLineItem') },
      orderLineDeliverySplit: { count: count('orderLineDeliverySplit') },
      plmTracker: { count: count('plmTracker') },
      rfqInvitee: { count: count('rfqInvitee') },
      purchaseOrder: { count: count('purchaseOrder') },
      accountsPayableInvoice: { count: count('accountsPayableInvoice') },
      accountsPayablePayment: { count: count('accountsPayablePayment') },
      vendor: { delete: jest.fn().mockResolvedValue({ id: 'vendor-1' }) },
    };
    const prisma = {
      vendor: {
        findUnique: jest.fn().mockResolvedValue({ id: 'vendor-1' }),
      },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new ScmService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, tx };
  }

  it('allows CEO/SuperAdmin to delete an unused vendor', async () => {
    const { service, tx } = setup();

    await expect(service.deleteVendor('vendor-1', superAdmin)).resolves.toEqual(
      {
        id: 'vendor-1',
        deleted: true,
      },
    );
    expect(tx.vendor.delete).toHaveBeenCalledWith({
      where: { id: 'vendor-1' },
    });
  });

  it('blocks deletion when the vendor has operational references', async () => {
    const { service, tx } = setup({ purchaseOrder: 2, rfqInvitee: 1 });

    await expect(service.deleteVendor('vendor-1', superAdmin)).rejects.toThrow(
      new ConflictException(
        'This vendor cannot be deleted because it is used by: RFQ invitations (1), purchase orders (2). Retain the vendor to preserve operational history.',
      ),
    );
    expect(tx.vendor.delete).not.toHaveBeenCalled();
  });

  it('rejects every non-SuperAdmin role', async () => {
    const { service, tx } = setup();

    await expect(
      service.deleteVendor('vendor-1', {
        ...superAdmin,
        role: Role.MANAGER,
      }),
    ).rejects.toThrow(
      new ForbiddenException('Only CEO/SuperAdmin may delete vendors'),
    );
    expect(tx.vendor.delete).not.toHaveBeenCalled();
  });
});
