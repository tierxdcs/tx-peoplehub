import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { LeadStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { LeadsService } from './leads.service';
import { SalesAccessService } from './common/sales-access.service';
import { SalesNumberingService } from './common/sales-numbering.service';

describe('LeadsService', () => {
  let service: LeadsService;
  let prisma: any;
  let access: any;
  let numbering: { nextNumber: jest.Mock };

  const rep: AuthenticatedUser = {
    id: 'emp-1',
    email: 'e@x.com',
    role: Role.EMPLOYEE,
    verticalId: 'v-sales',
  };

  beforeEach(async () => {
    prisma = {
      lead: {
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      customer: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };
    access = {
      assertSalesAccess: jest.fn().mockResolvedValue(undefined),
      assertCanAccessOwned: jest.fn().mockResolvedValue(undefined),
      visibleOwnerIds: jest.fn().mockResolvedValue(['emp-1']),
    };
    numbering = { nextNumber: jest.fn().mockResolvedValue('LD-2026-0001') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SalesAccessService, useValue: access },
        { provide: SalesNumberingService, useValue: numbering },
      ],
    }).compile();

    service = module.get(LeadsService);
  });

  const convertDto = {
    opportunityName: 'Globex — LC25',
    estimatedValue: 6250000,
    expectedCloseDate: '2026-09-30',
    billingAddress: { state: 'Maharashtra' },
  };

  it('rejects converting a lead that is not QUALIFIED', async () => {
    prisma.lead.findUnique.mockResolvedValue({
      id: 'lead-1',
      status: LeadStatus.NEW,
      ownerId: 'emp-1',
      enquiryCreatorId: 'emp-1',
      enquiryCreator: { firstName: 'Sales', lastName: 'Rep' },
      owner: { firstName: 'Sales', lastName: 'Rep' },
    });
    await expect(
      service.convert('lead-1', convertDto, rep),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects converting an already-converted lead', async () => {
    prisma.lead.findUnique.mockResolvedValue({
      id: 'lead-1',
      status: LeadStatus.CONVERTED,
      ownerId: 'emp-1',
      enquiryCreatorId: 'emp-1',
      enquiryCreator: { firstName: 'Sales', lastName: 'Rep' },
      owner: { firstName: 'Sales', lastName: 'Rep' },
    });
    await expect(
      service.convert('lead-1', convertDto, rep),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires billingAddress when no existing customerId is given', async () => {
    prisma.lead.findUnique.mockResolvedValue({
      id: 'lead-1',
      status: LeadStatus.QUALIFIED,
      ownerId: 'emp-1',
      enquiryCreatorId: 'emp-1',
      enquiryCreator: { firstName: 'Sales', lastName: 'Rep' },
      owner: { firstName: 'Sales', lastName: 'Rep' },
      companyName: 'Globex',
      contactName: 'Priya',
      email: null,
      phone: null,
    });
    await expect(
      service.convert(
        'lead-1',
        { ...convertDto, billingAddress: undefined },
        rep,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('converts a QUALIFIED lead: creates customer + opportunity and marks lead CONVERTED', async () => {
    prisma.lead.findUnique.mockResolvedValue({
      id: 'lead-1',
      status: LeadStatus.QUALIFIED,
      ownerId: 'emp-1',
      enquiryCreatorId: 'emp-1',
      enquiryCreator: { firstName: 'Sales', lastName: 'Rep' },
      owner: { firstName: 'Sales', lastName: 'Rep' },
      companyName: 'Globex',
      contactName: 'Priya',
      email: 'p@globex.com',
      phone: '123',
    });

    const customerCreate = jest.fn().mockResolvedValue({ id: 'cust-1' });
    const oppCreate = jest.fn().mockResolvedValue({
      id: 'opp-1',
      leadId: 'lead-1',
      customerId: 'cust-1',
      name: convertDto.opportunityName,
      stage: 'PROSPECTING',
      estimatedValue: new Prisma.Decimal(convertDto.estimatedValue),
      expectedCloseDate: new Date(convertDto.expectedCloseDate),
      ownerId: 'emp-1',
      enquiryCreatorId: 'emp-1',
      enquiryCreator: { firstName: 'Sales', lastName: 'Rep' },
      owner: { firstName: 'Sales', lastName: 'Rep' },
      lostReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const leadUpdate = jest.fn().mockResolvedValue({});
    prisma.$transaction.mockImplementation(async (cb: any) =>
      cb({
        customer: { create: customerCreate },
        opportunity: { create: oppCreate },
        lead: { update: leadUpdate },
      }),
    );

    const result = await service.convert('lead-1', convertDto, rep);
    expect(customerCreate).toHaveBeenCalled();
    expect(result.id).toBe('opp-1');
    expect(result.customerId).toBe('cust-1');
    expect(result.enquiryCreatorId).toBe('emp-1');
    expect(result.enquiryCreatorName).toBe('Sales Rep');
    expect(oppCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ enquiryCreatorId: 'emp-1' }),
      }),
    );
    // Lead marked CONVERTED and linked to the new opportunity.
    const leadUpdateArg = leadUpdate.mock.calls[0][0];
    expect(leadUpdateArg.data.status).toBe(LeadStatus.CONVERTED);
    expect(leadUpdateArg.data.convertedToOpportunityId).toBe('opp-1');
  });

  describe('vertical-wide read access', () => {
    it('findAll applies NO owner filter (any Sales staff sees all leads)', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.findAll({ page: 1, limit: 20, skip: 0 } as any, rep);

      const whereArg = prisma.lead.findMany.mock.calls[0][0].where;
      expect(whereArg).toEqual({});
      // The write-scope helper must NOT drive reads anymore.
      expect(access.visibleOwnerIds).not.toHaveBeenCalled();
    });

    it('findOne returns a peer-owned lead without an ownership check', async () => {
      // Lead owned by a *different* employee — the key new case.
      prisma.lead.findUnique.mockResolvedValue({
        id: 'lead-peer',
        leadNumber: 'LD-2026-0009',
        companyName: 'Peer Co',
        contactName: 'X',
        email: null,
        phone: null,
        requirement: 'y',
        priority: 'MEDIUM',
        source: 'OTHER',
        status: LeadStatus.NEW,
        ownerId: 'other-emp',
        enquiryCreatorId: 'other-emp',
        enquiryCreator: { firstName: 'Peer', lastName: 'Rep' },
        owner: { firstName: 'Peer', lastName: 'Rep' },
        disqualifiedReason: null,
        convertedToOpportunityId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.findOne('lead-peer', rep);

      expect(result.id).toBe('lead-peer');
      // Reads no longer gate on ownership.
      expect(access.assertCanAccessOwned).not.toHaveBeenCalled();
    });

    it('update still enforces the owner check (writes unchanged)', async () => {
      prisma.lead.findUnique.mockResolvedValue({
        id: 'lead-peer',
        status: LeadStatus.NEW,
        ownerId: 'other-emp',
      });
      // Simulate the real write guard rejecting a non-owner.
      access.assertCanAccessOwned.mockRejectedValue(
        new Error('outside your team'),
      );

      await expect(
        service.update('lead-peer', { requirement: 'edit' }, rep),
      ).rejects.toThrow('outside your team');
      expect(access.assertCanAccessOwned).toHaveBeenCalledWith(
        rep,
        'other-emp',
      );
    });
  });
});
