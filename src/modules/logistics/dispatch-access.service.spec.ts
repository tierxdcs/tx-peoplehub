import { ForbiddenException } from '@nestjs/common';
import { EmployeeStatus, Role } from '@prisma/client';
import { DispatchAccessService } from './dispatch-access.service';

describe('DispatchAccessService picker visibility', () => {
  const employee = (overrides: Record<string, unknown>) => ({
    status: EmployeeStatus.ACTIVE,
    isQcInspector: false,
    vertical: { code: 'SALES' },
    ...overrides,
  });
  const user = {
    id: 'employee-1',
    email: 'person@example.com',
    role: Role.EMPLOYEE,
    verticalId: 'vertical-1',
  };

  it.each([
    employee({ vertical: { code: 'QUALITY' } }),
    employee({ isQcInspector: true }),
    employee({ vertical: { code: 'PRODUCTION' } }),
  ])('allows active Quality, QC Inspector, and Production users', async (record) => {
    const prisma = { employee: { findUnique: jest.fn().mockResolvedValue(record) } };
    const service = new DispatchAccessService(prisma as never);
    await expect(service.assertCanViewDispatchOrders(user)).resolves.toBeUndefined();
  });

  it('does not broaden the picker to unrelated verticals', async () => {
    const prisma = {
      employee: { findUnique: jest.fn().mockResolvedValue(employee({})) },
    };
    const service = new DispatchAccessService(prisma as never);
    await expect(service.assertCanViewDispatchOrders(user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it.each([
    employee({ isQcInspector: true }),
    employee({ vertical: { code: 'PRODUCTION' } }),
  ])('allows active QC Inspectors and Production users to raise dispatches', async (record) => {
    const prisma = {
      employee: { findUnique: jest.fn().mockResolvedValue(record) },
    };
    const service = new DispatchAccessService(prisma as never);
    await expect(service.assertCanDispatch(user)).resolves.toBeUndefined();
  });

  it('does not grant dispatch write access to Quality users without the QC Inspector capability', async () => {
    const prisma = {
      employee: {
        findUnique: jest.fn().mockResolvedValue(
          employee({ vertical: { code: 'QUALITY' }, isQcInspector: false }),
        ),
      },
    };
    const service = new DispatchAccessService(prisma as never);
    await expect(service.assertCanDispatch(user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
