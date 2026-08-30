import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { SupplierService } from './supplier.service';

/** Supplier twin of scm/scm-invite-email.spec.ts — same rules, supplier noun. */
describe('SupplierService.sendInviteEmail', () => {
  const user = {
    id: 'emp-1',
    email: 'scm@example.com',
    role: Role.MANAGER,
    verticalId: 'v-scm',
  };
  const now = new Date('2026-08-30T10:00:00.000Z');

  type InviteRow = {
    token: string;
    expiresAt: Date;
    revokedAt: Date | null;
    passwordHash: string | null;
    questionnaire: {
      supplier: {
        companyName: string;
        contactEmail: string;
        contactPersonName: string | null;
      };
    };
  };

  const INVITE: InviteRow = {
    token: 'tok_sup789',
    expiresAt: new Date('2026-09-13T10:00:00.000Z'),
    revokedAt: null,
    passwordHash: null,
    questionnaire: {
      supplier: {
        companyName: 'Bharat Steels',
        contactEmail: 'sales@bharatsteels.test',
        contactPersonName: null,
      },
    },
  };

  function setup(invite: InviteRow | null = INVITE) {
    const send = jest.fn().mockResolvedValue({
      id: 'msg_2',
      recipients: ['sales@bharatsteels.test'],
      blocked: [],
    });
    const prisma = {
      supplierQuestionnaireInvite: {
        findUnique: jest.fn().mockResolvedValue(invite),
      },
      financeCompanySettings: {
        findFirst: jest.fn().mockResolvedValue({ legalName: 'Phaze Dynamics' }),
      },
    };
    const access = { assertCanManageSuppliers: jest.fn() };
    const config = {
      get: (key: string) =>
        key === 'frontendOrigin' ? 'https://app.example.com' : 'Asia/Kolkata',
    };
    const service = new SupplierService(
      prisma as never,
      access as never,
      {} as never,
      {} as never,
      { send } as never,
      config as never,
    );
    return { service, send, access };
  }

  it('emails the supplier contact with the supplier-flavoured template', async () => {
    const { service, send, access } = setup();

    await expect(
      service.sendInviteEmail('inv-1', {}, user, now),
    ).resolves.toEqual({
      recipients: ['sales@bharatsteels.test'],
      blocked: [],
      messageId: 'msg_2',
      skipped: null,
    });
    expect(access.assertCanManageSuppliers).toHaveBeenCalledWith(user);
    const message = send.mock.calls[0][0];
    expect(message.to).toBe('sales@bharatsteels.test');
    expect(message.subject).toBe(
      'Supplier qualification questionnaire — Phaze Dynamics',
    );
    expect(message.tags).toEqual([
      { name: 'kind', value: 'supplier-qualification-invite' },
    ]);
    // Greeting falls back to the company when no contact person is on file.
    expect(message.text).toContain('Hello Bharat Steels,');
    expect(message.text).toContain(
      'https://app.example.com/public/supplier-questionnaire/tok_sup789',
    );
  });

  it('honours a recipient override', async () => {
    const { service, send } = setup();

    await service.sendInviteEmail(
      'inv-1',
      { to: 'quality@bharatsteels.test' },
      user,
      now,
    );

    expect(send.mock.calls[0][0].to).toBe('quality@bharatsteels.test');
  });

  it('404s an unknown invite', async () => {
    const { service, send } = setup(null);

    await expect(
      service.sendInviteEmail('inv-x', {}, user, now),
    ).rejects.toThrow(NotFoundException);
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses revoked and expired invites', async () => {
    const revoked = setup({ ...INVITE, revokedAt: new Date() });
    await expect(
      revoked.service.sendInviteEmail('inv-1', {}, user, now),
    ).rejects.toThrow(BadRequestException);
    expect(revoked.send).not.toHaveBeenCalled();

    const expired = setup({
      ...INVITE,
      expiresAt: new Date('2026-08-29T10:00:00.000Z'),
    });
    await expect(
      expired.service.sendInviteEmail('inv-1', {}, user, now),
    ).rejects.toThrow(BadRequestException);
    expect(expired.send).not.toHaveBeenCalled();
  });

  it('refuses when the supplier has no usable contact email', async () => {
    const { service, send } = setup({
      ...INVITE,
      questionnaire: {
        supplier: { ...INVITE.questionnaire.supplier, contactEmail: 'nope' },
      },
    });

    await expect(
      service.sendInviteEmail('inv-1', {}, user, now),
    ).rejects.toThrow(
      new BadRequestException(
        'This supplier has no valid contact email — supply a recipient',
      ),
    );
    expect(send).not.toHaveBeenCalled();
  });
});
