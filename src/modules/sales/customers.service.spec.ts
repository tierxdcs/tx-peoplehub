import { ConflictException, ForbiddenException } from '@nestjs/common';
import { CustomerStatus, Role } from '@prisma/client';
import { CustomersService } from './customers.service';

describe('CustomersService.remove', () => {
  const superAdmin = {
    id: 'admin-1',
    employeeId: 'EMP-1',
    email: 'admin@example.com',
    role: Role.SUPER_ADMIN,
    verticalId: null,
  };
  const customer = {
    id: 'customer-1',
    name: 'Unused Customer',
    gstin: null,
    billingAddress: {},
    shippingAddress: null,
    industry: null,
    ownerId: 'owner-1',
    status: CustomerStatus.ACTIVE,
    contacts: [],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  function setup(referenceCounts: Partial<Record<string, number>> = {}) {
    const count = (key: string) =>
      jest.fn().mockResolvedValue(referenceCounts[key] ?? 0);
    const tx = {
      opportunity: { count: count('opportunity') },
      bid: { count: count('bid') },
      order: { count: count('order') },
      salesInvoice: { count: count('salesInvoice') },
      customerReceipt: { count: count('customerReceipt') },
      deliveryChallan: { count: count('deliveryChallan') },
      designRequest: { count: count('designRequest') },
      designProject: { count: count('designProject') },
      qmsCustomerComplaint: { count: count('qmsCustomerComplaint') },
      customerCreditControl: { count: count('customerCreditControl') },
      customer: { delete: jest.fn().mockResolvedValue(customer) },
    };
    const prisma = {
      customer: { findUnique: jest.fn().mockResolvedValue(customer) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const access = { isSalesStaff: jest.fn().mockResolvedValue(true) };
    const service = new CustomersService(prisma as never, access as never);
    return { service, tx };
  }

  it('deletes a customer with no operational references', async () => {
    const { service, tx } = setup();

    await expect(service.remove(customer.id, superAdmin)).resolves.toEqual({
      id: customer.id,
      deleted: true,
    });
    expect(tx.customer.delete).toHaveBeenCalledWith({
      where: { id: customer.id },
    });
  });

  it('blocks deletion and reports each reference category found', async () => {
    const { service, tx } = setup({ order: 2, qmsCustomerComplaint: 1 });

    await expect(service.remove(customer.id, superAdmin)).rejects.toThrow(
      'This customer cannot be deleted because it is used by: orders (2), customer complaints (1). Mark it inactive instead to preserve history.',
    );
    expect(tx.customer.delete).not.toHaveBeenCalled();
  });

  it('does not allow a regular Sales employee to delete customers', async () => {
    const { service } = setup();

    await expect(
      service.remove(customer.id, {
        ...superAdmin,
        role: Role.EMPLOYEE,
        verticalId: 'sales-1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('uses a conflict response for referenced customers', async () => {
    const { service } = setup({ salesInvoice: 1 });

    await expect(
      service.remove(customer.id, superAdmin),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
