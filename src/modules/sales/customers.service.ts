import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Customer, CustomerContact, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  PaginatedResult,
  PaginationQueryDto,
} from '../../common/dto/pagination.dto';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import {
  CustomerContactEntity,
  CustomerEntity,
} from './entities/customer.entity';
import {
  SalesAccessService,
  isSuperAdmin,
} from './common/sales-access.service';

type CustomerWithContacts = Customer & { contacts: CustomerContact[] };

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: SalesAccessService,
  ) {}

  async create(
    dto: CreateCustomerDto,
    user: AuthenticatedUser,
  ): Promise<CustomerEntity> {
    await this.access.assertSalesAccess(user);
    this.assertValidPrimaryContacts(dto.contacts);

    const ownerId = await this.resolveOwnerId(dto.ownerId, user);

    const created = await this.prisma.customer.create({
      data: {
        name: dto.name,
        gstin: dto.gstin ?? null,
        billingAddress: dto.billingAddress as Prisma.InputJsonValue,
        // Shipping defaults to billing when not provided.
        shippingAddress: (dto.shippingAddress ??
          dto.billingAddress) as Prisma.InputJsonValue,
        industry: dto.industry ?? null,
        ownerId,
        contacts: dto.contacts?.length
          ? {
              create: dto.contacts.map((c) => ({
                name: c.name,
                email: c.email ?? null,
                phone: c.phone ?? null,
                designation: c.designation ?? null,
                isPrimary: c.isPrimary ?? false,
              })),
            }
          : undefined,
      },
      include: { contacts: true },
    });
    return this.toEntity(created);
  }

  async findAll(
    query: PaginationQueryDto,
    user: AuthenticatedUser,
  ): Promise<PaginatedResult<CustomerEntity>> {
    await this.access.assertSalesAccess(user);
    const ownerIds = await this.access.visibleOwnerIds(user);
    const where: Prisma.CustomerWhereInput = ownerIds
      ? { ownerId: { in: ownerIds } }
      : {};

    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        include: { contacts: true },
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.customer.count({ where }),
    ]);
    return {
      items: items.map((c) => this.toEntity(c)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async findOne(id: string, user: AuthenticatedUser): Promise<CustomerEntity> {
    await this.access.assertSalesAccess(user);
    const customer = await this.findRawOrThrow(id);
    await this.access.assertCanAccessOwned(user, customer.ownerId);
    return this.toEntity(customer);
  }

  async update(
    id: string,
    dto: UpdateCustomerDto,
    user: AuthenticatedUser,
  ): Promise<CustomerEntity> {
    await this.access.assertSalesAccess(user);
    const existing = await this.findRawOrThrow(id);
    await this.access.assertCanAccessOwned(user, existing.ownerId);

    // Reassigning an owner is a manager/super-admin action.
    if (dto.ownerId && dto.ownerId !== existing.ownerId) {
      this.assertCanAssignOwner(user);
    }

    this.assertValidPrimaryContacts(dto.contacts);
    if (dto.contacts) {
      const existingIds = new Set(
        existing.contacts.map((contact) => contact.id),
      );
      const foreignId = dto.contacts.find(
        (contact) => contact.id && !existingIds.has(contact.id),
      );
      if (foreignId) {
        throw new BadRequestException(
          'A supplied contact does not belong to this customer',
        );
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.contacts) {
        const retainedIds = dto.contacts
          .map((contact) => contact.id)
          .filter((contactId): contactId is string => Boolean(contactId));
        await tx.customerContact.deleteMany({
          where: {
            customerId: id,
            ...(retainedIds.length ? { id: { notIn: retainedIds } } : {}),
          },
        });
        for (const contact of dto.contacts) {
          const data = {
            name: contact.name.trim(),
            email: contact.email?.trim() || null,
            phone: contact.phone?.trim() || null,
            designation: contact.designation?.trim() || null,
            isPrimary: contact.isPrimary ?? false,
          };
          if (contact.id) {
            await tx.customerContact.update({
              where: { id: contact.id },
              data,
            });
          } else {
            await tx.customerContact.create({
              data: { ...data, customerId: id },
            });
          }
        }
      }

      return tx.customer.update({
        where: { id },
        data: {
          name: dto.name,
          gstin: dto.gstin,
          billingAddress: dto.billingAddress as
            Prisma.InputJsonValue | undefined,
          shippingAddress: dto.shippingAddress as
            Prisma.InputJsonValue | undefined,
          industry: dto.industry,
          status: dto.status,
          ownerId: dto.ownerId,
        },
        include: { contacts: true },
      });
    });
    return this.toEntity(updated);
  }

  async remove(
    id: string,
    user: AuthenticatedUser,
  ): Promise<{ id: string; deleted: true }> {
    const canDelete =
      isSuperAdmin(user) ||
      (user.role === Role.MANAGER && (await this.access.isSalesStaff(user)));
    if (!canDelete) {
      throw new ForbiddenException(
        'Only Sales Managers or CEO/SuperAdmin may delete customers',
      );
    }

    await this.findRawOrThrow(id);
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Contacts are owned by the customer and cascade safely. Every other
        // link, including nullable/SetNull links, is treated as real history
        // and therefore blocks permanent deletion.
        const referenceChecks = await Promise.all([
          tx.opportunity.count({ where: { customerId: id } }),
          tx.bid.count({ where: { customerId: id } }),
          tx.order.count({ where: { customerId: id } }),
          tx.salesInvoice.count({ where: { customerId: id } }),
          tx.customerReceipt.count({ where: { customerId: id } }),
          tx.deliveryChallan.count({ where: { customerId: id } }),
          tx.designRequest.count({ where: { customerId: id } }),
          tx.designProject.count({ where: { customerId: id } }),
          tx.qmsCustomerComplaint.count({ where: { customerId: id } }),
          tx.customerCreditControl.count({ where: { customerId: id } }),
        ]);
        const labels = [
          'opportunities',
          'bids',
          'orders',
          'sales invoices',
          'customer receipts',
          'delivery challans',
          'design requests',
          'design projects',
          'customer complaints',
          'credit-control records',
        ];
        const usedBy = referenceChecks
          .map((count, index) => (count ? `${labels[index]} (${count})` : null))
          .filter(Boolean);
        if (usedBy.length) {
          throw new ConflictException(
            `This customer cannot be deleted because it is used by: ${usedBy.join(', ')}. Mark it inactive instead to preserve history.`,
          );
        }

        await tx.customer.delete({ where: { id } });
        return { id, deleted: true as const };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new ConflictException(
          'This customer cannot be deleted because it is referenced elsewhere in the system. Mark it inactive instead.',
        );
      }
      throw error;
    }
  }

  private assertValidPrimaryContacts(
    contacts: Array<{ isPrimary?: boolean }> | undefined,
  ): void {
    if (
      contacts &&
      contacts.filter((contact) => contact.isPrimary).length > 1
    ) {
      throw new BadRequestException(
        'Only one customer contact can be marked as primary',
      );
    }
  }

  /**
   * Owner defaults to the creating user. Only a MANAGER or SUPER_ADMIN may
   * set a different owner (an EMPLOYEE can only own their own records).
   */
  private async resolveOwnerId(
    requestedOwnerId: string | undefined,
    user: AuthenticatedUser,
  ): Promise<string> {
    if (!requestedOwnerId || requestedOwnerId === user.id) {
      return user.id;
    }
    this.assertCanAssignOwner(user);
    const owner = await this.prisma.employee.findUnique({
      where: { id: requestedOwnerId },
    });
    if (!owner) {
      throw new NotFoundException('Assigned owner not found');
    }
    return requestedOwnerId;
  }

  private assertCanAssignOwner(user: AuthenticatedUser): void {
    if (user.role !== Role.MANAGER && !isSuperAdmin(user)) {
      throw new ForbiddenException(
        'Only a Sales Manager or SUPER_ADMIN may assign a record to another owner',
      );
    }
  }

  private async findRawOrThrow(id: string): Promise<CustomerWithContacts> {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: { contacts: true },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    return customer;
  }

  private toEntity(customer: CustomerWithContacts): CustomerEntity {
    return new CustomerEntity({
      id: customer.id,
      name: customer.name,
      gstin: customer.gstin,
      billingAddress: customer.billingAddress as Record<string, unknown>,
      shippingAddress: customer.shippingAddress as Record<string, unknown>,
      industry: customer.industry,
      ownerId: customer.ownerId,
      status: customer.status,
      contacts: customer.contacts.map(
        (c) =>
          new CustomerContactEntity({
            id: c.id,
            customerId: c.customerId,
            name: c.name,
            email: c.email,
            phone: c.phone,
            designation: c.designation,
            isPrimary: c.isPrimary,
          }),
      ),
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    });
  }
}
