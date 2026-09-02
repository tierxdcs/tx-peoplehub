import { BadRequestException } from '@nestjs/common';
import { OrderConfirmationStatus, Role } from '@prisma/client';
import { ConfirmationSheetsService } from './confirmation-sheets.service';

describe('ConfirmationSheetsService — draft deletion', () => {
  const user = {
    id: 'sales-1',
    email: 'sales@example.com',
    role: Role.EMPLOYEE,
    verticalId: 'sales',
  };

  function setup(status: OrderConfirmationStatus) {
    const sheet = {
      id: 'sheet-1',
      orderId: 'order-1',
      status,
    };
    const prisma = {
      orderConfirmationSheet: {
        findUnique: jest.fn().mockResolvedValue(sheet),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      order: {
        findUnique: jest.fn().mockResolvedValue({ ownerId: user.id }),
      },
    };
    const access = {
      assertSalesAccess: jest.fn().mockResolvedValue(undefined),
      assertCanAccessOwned: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ConfirmationSheetsService(
      prisma as never,
      access as never,
      {} as never,
      {} as never,
    );
    return { service, prisma, access };
  }

  it('deletes a draft after applying the existing order write scope', async () => {
    const { service, prisma, access } = setup(OrderConfirmationStatus.DRAFT);

    await expect(service.remove('sheet-1', user)).resolves.toEqual({
      id: 'sheet-1',
    });

    expect(access.assertCanAccessOwned).toHaveBeenCalledWith(user, user.id);
    expect(prisma.orderConfirmationSheet.deleteMany).toHaveBeenCalledWith({
      where: { id: 'sheet-1', status: OrderConfirmationStatus.DRAFT },
    });
  });

  it.each([
    OrderConfirmationStatus.AWAITING_CUSTOMER_SIGNATURE,
    OrderConfirmationStatus.AWAITING_INTERNAL_SIGNATURE,
    OrderConfirmationStatus.REJECTED,
    OrderConfirmationStatus.EXECUTED,
  ])('refuses to delete a %s sheet', async (status) => {
    const { service, prisma } = setup(status);

    await expect(service.remove('sheet-1', user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.orderConfirmationSheet.deleteMany).not.toHaveBeenCalled();
  });

  it('fails safely if the sheet stops being a draft during deletion', async () => {
    const { service, prisma } = setup(OrderConfirmationStatus.DRAFT);
    prisma.orderConfirmationSheet.deleteMany.mockResolvedValue({ count: 0 });

    await expect(service.remove('sheet-1', user)).rejects.toThrow(
      'no longer a DRAFT',
    );
  });
});
