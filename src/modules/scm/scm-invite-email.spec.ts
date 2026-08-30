import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ScmService } from './scm.service';

/**
 * The vendor half of the shared invite-email action. Its supplier twin
 * (scm-supplier/supplier-invite-email.spec.ts) asserts the same rules — both
 * exist because the two modules are separate call sites of one template, and a
 * regression in either would be invisible in the other.
 */
describe('ScmService.sendInviteEmail', () => {
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
      vendor: {
        companyName: string;
        contactEmail: string;
        contactPersonName: string | null;
      };
    };
  };

  const INVITE: InviteRow = {
    token: 'tok_abc123',
    expiresAt: new Date('2026-09-13T10:00:00.000Z'),
    revokedAt: null,
    passwordHash: null,
    questionnaire: {
      vendor: {
        companyName: 'Acme Fabrication',
        contactEmail: 'contact@acme.test',
        contactPersonName: 'R. Iyer',
      },
    },
  };

  function setup(invite: InviteRow | null = INVITE) {
    const send = jest.fn().mockResolvedValue({
      id: 'msg_1',
      recipients: ['contact@acme.test'],
      blocked: [],
    });
    const prisma = {
      vendorQuestionnaireInvite: {
        findUnique: jest.fn().mockResolvedValue(invite),
      },
      financeCompanySettings: {
        findFirst: jest.fn().mockResolvedValue({ legalName: 'Phaze Dynamics' }),
      },
    };
    const access = { assertCanManageVendors: jest.fn() };
    const config = {
      get: (key: string) =>
        key === 'frontendOrigin' ? 'https://app.example.com/' : 'Asia/Kolkata',
    };
    const service = new ScmService(
      prisma as never,
      access as never,
      {} as never,
      {} as never,
      {} as never,
      { send } as never,
      config as never,
    );
    return { service, send, access };
  }

  it('emails the vendor contact on file and returns the send result', async () => {
    const { service, send, access } = setup();

    await expect(
      service.sendInviteEmail('inv-1', {}, user, now),
    ).resolves.toEqual({
      recipients: ['contact@acme.test'],
      blocked: [],
      messageId: 'msg_1',
      skipped: null,
    });
    expect(access.assertCanManageVendors).toHaveBeenCalledWith(user);
    const message = send.mock.calls[0][0];
    expect(message.to).toBe('contact@acme.test');
    expect(message.subject).toBe(
      'Vendor qualification questionnaire — Phaze Dynamics',
    );
    expect(message.tags).toEqual([
      { name: 'kind', value: 'vendor-qualification-invite' },
    ]);
    // No idempotency key: a second press is a deliberate re-send.
    expect(message.idempotencyKey).toBeUndefined();
  });

  it('builds the public link from the configured frontend origin', async () => {
    const { service, send } = setup();

    await service.sendInviteEmail('inv-1', {}, user, now);

    const { html, text } = send.mock.calls[0][0];
    const url =
      'https://app.example.com/public/vendor-questionnaire/tok_abc123';
    expect(html).toContain(url);
    expect(text).toContain(url);
  });

  it('honours a recipient override', async () => {
    const { service, send } = setup();

    await service.sendInviteEmail('inv-1', { to: 'qa@acme.test' }, user, now);

    expect(send.mock.calls[0][0].to).toBe('qa@acme.test');
  });

  it('passes the note through to the body', async () => {
    const { service, send } = setup();

    await service.sendInviteEmail(
      'inv-1',
      { note: 'Please complete before Friday.' },
      user,
      now,
    );

    expect(send.mock.calls[0][0].text).toContain(
      'Please complete before Friday.',
    );
  });

  it('never puts the invite password in the email', async () => {
    const { service, send } = setup({
      ...INVITE,
      passwordHash: '$2b$10$hashedsecret',
    });

    await service.sendInviteEmail('inv-1', {}, user, now);

    const { html, text } = send.mock.calls[0][0];
    expect(text).toContain('password-protected');
    expect(html).not.toContain('$2b$10$');
    expect(text).not.toContain('$2b$10$');
  });

  it('404s an unknown invite', async () => {
    const { service, send } = setup(null);

    await expect(
      service.sendInviteEmail('inv-x', {}, user, now),
    ).rejects.toThrow(NotFoundException);
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a revoked invite — the link would not work', async () => {
    const { service, send } = setup({ ...INVITE, revokedAt: new Date() });

    await expect(
      service.sendInviteEmail('inv-1', {}, user, now),
    ).rejects.toThrow(
      new BadRequestException(
        'This invite has been revoked — generate a new one before emailing it',
      ),
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses an expired invite', async () => {
    const { service, send } = setup({
      ...INVITE,
      expiresAt: new Date('2026-08-29T10:00:00.000Z'),
    });

    await expect(
      service.sendInviteEmail('inv-1', {}, user, now),
    ).rejects.toThrow(
      new BadRequestException(
        'This invite has expired — generate a new one before emailing it',
      ),
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses when the vendor has no usable contact email', async () => {
    const { service, send } = setup({
      ...INVITE,
      questionnaire: {
        vendor: { ...INVITE.questionnaire.vendor, contactEmail: '' },
      },
    });

    await expect(
      service.sendInviteEmail('inv-1', {}, user, now),
    ).rejects.toThrow(
      new BadRequestException(
        'This vendor has no valid contact email — supply a recipient',
      ),
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('reports a skipped send (dry-run / allowlist) rather than claiming delivery', async () => {
    const { service, send } = setup();
    send.mockResolvedValue({
      id: null,
      recipients: [],
      blocked: ['contact@acme.test'],
      skipped: 'suppressed-by-allowlist',
    });

    await expect(
      service.sendInviteEmail('inv-1', {}, user, now),
    ).resolves.toEqual({
      recipients: [],
      blocked: ['contact@acme.test'],
      messageId: null,
      skipped: 'suppressed-by-allowlist',
    });
  });
});
