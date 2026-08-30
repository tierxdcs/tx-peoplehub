import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { EmailService, type EmailConfig } from './email.service';

const sendMock = jest.fn();
const domainsListMock = jest.fn();
const domainsGetMock = jest.fn();
const resendCtor = jest.fn();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation((key: string) => {
    resendCtor(key);
    return {
      emails: { send: sendMock },
      domains: { list: domainsListMock, get: domainsGetMock },
    };
  }),
}));

const BASE: EmailConfig = {
  apiKey: 're_test_key',
  from: 'tx-peoplehub <no-reply@acme.com>',
  replyTo: undefined,
  allowedRecipients: [],
  dryRun: false,
};

function build(overrides: Partial<EmailConfig> = {}) {
  const cfg = { ...BASE, ...overrides };
  return new EmailService({
    get: () => cfg,
  } as unknown as ConfigService);
}

beforeAll(() => {
  // Keep the boot warnings out of the test output.
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

beforeEach(() => {
  jest.clearAllMocks();
  // A default happy-path provider response; tests override where it matters.
  sendMock.mockResolvedValue({ data: { id: 'msg_default' }, error: null });
});

describe('EmailService without configuration', () => {
  it('reports itself unconfigured and names the missing vars', async () => {
    const service = build({ apiKey: undefined, from: undefined });
    expect(service.isConfigured()).toBe(false);
    await expect(
      service.send({ to: 'a@x.com', subject: 'Hi', text: 'Hi' }),
    ).rejects.toThrow('set RESEND_API_KEY, EMAIL_FROM');
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('rejects an EMAIL_FROM that would fail silently at the provider', async () => {
    const service = build({ from: 'no-reply@acme' });
    expect(service.isConfigured()).toBe(false);
    await expect(
      service.send({ to: 'a@x.com', subject: 'Hi', text: 'Hi' }),
    ).rejects.toThrow('EMAIL_FROM is not a valid sender address');
  });

  it('lets trySend swallow it, so a business action is never rolled back', async () => {
    const service = build({ apiKey: undefined, from: undefined });
    await expect(
      service.trySend(
        { to: 'a@x.com', subject: 'Hi', text: 'Hi' },
        'vendor-invite',
      ),
    ).resolves.toBeNull();
  });
});

describe('EmailService.send', () => {
  it('sends through Resend and returns the message id', async () => {
    sendMock.mockResolvedValue({ data: { id: 'msg_1' }, error: null });
    const service = build();

    const result = await service.send({
      to: ' a@x.com , A@x.com ',
      subject: 'Invite',
      html: '<p>Open the <a href="https://app.acme.com/i/1">invite</a>.</p>',
    });

    expect(result).toEqual({
      id: 'msg_1',
      recipients: ['a@x.com'],
      blocked: [],
    });
    expect(resendCtor).toHaveBeenCalledWith('re_test_key');
    const [payload, options] = sendMock.mock.calls[0];
    expect(payload.from).toBe('tx-peoplehub <no-reply@acme.com>');
    expect(payload.to).toEqual(['a@x.com']);
    // A text alternative is always sent, derived from the HTML when absent.
    expect(payload.text).toBe('Open the invite (https://app.acme.com/i/1).');
    expect(options).toBeUndefined();
  });

  it('passes an idempotency key through so a retry cannot double-send', async () => {
    sendMock.mockResolvedValue({ data: { id: 'msg_2' }, error: null });
    await build().send({
      to: 'a@x.com',
      subject: 'Invite',
      text: 'Open',
      idempotencyKey: 'invite-42',
    });
    expect(sendMock.mock.calls[0][1]).toEqual({ idempotencyKey: 'invite-42' });
  });

  it('falls back to EMAIL_REPLY_TO and lets a message override it', async () => {
    sendMock.mockResolvedValue({ data: { id: 'msg_3' }, error: null });
    const service = build({ replyTo: 'ops@acme.com' });

    await service.send({ to: 'a@x.com', subject: 'S', text: 'T' });
    expect(sendMock.mock.calls[0][0].replyTo).toBe('ops@acme.com');

    await service.send({
      to: 'a@x.com',
      subject: 'S',
      text: 'T',
      replyTo: 'rfq@acme.com',
    });
    expect(sendMock.mock.calls[1][0].replyTo).toBe('rfq@acme.com');
  });

  it('surfaces a provider error, which the SDK returns rather than throws', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { message: 'domain is not verified', name: 'validation_error' },
    });
    const service = build();

    await expect(
      service.send({ to: 'a@x.com', subject: 'S', text: 'T' }),
    ).rejects.toThrow('Email send failed: domain is not verified');
    await expect(
      service.trySend({ to: 'a@x.com', subject: 'S', text: 'T' }),
    ).resolves.toBeNull();
  });

  it('refuses a message with no body and one with no recipients', async () => {
    const service = build();
    await expect(service.send({ to: 'a@x.com', subject: 'S' })).rejects.toThrow(
      'html or text',
    );
    await expect(
      service.send({ to: ' , ', subject: 'S', text: 'T' }),
    ).rejects.toThrow('no recipients');
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe('EmailService safety rails', () => {
  it('drops recipients outside EMAIL_ALLOWED_RECIPIENTS without an error', async () => {
    const service = build({ allowedRecipients: ['@acme.com'] });

    const result = await service.send({
      to: ['ops@acme.com', 'customer@elsewhere.com'],
      subject: 'S',
      text: 'T',
    });
    expect(result.recipients).toEqual(['ops@acme.com']);
    expect(result.blocked).toEqual(['customer@elsewhere.com']);
    expect(sendMock.mock.calls[0][0].to).toEqual(['ops@acme.com']);
  });

  it('skips the provider entirely when the allowlist blocks everyone', async () => {
    const service = build({ allowedRecipients: ['@acme.com'] });

    const result = await service.send({
      to: 'customer@elsewhere.com',
      subject: 'S',
      text: 'T',
    });
    expect(result).toEqual({
      id: null,
      recipients: [],
      blocked: ['customer@elsewhere.com'],
      skipped: 'suppressed-by-allowlist',
    });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('logs instead of delivering under EMAIL_DRY_RUN, still counting as configured', async () => {
    const service = build({ dryRun: true });

    const result = await service.send({
      to: 'a@x.com',
      subject: 'S',
      text: 'T',
    });
    expect(result.skipped).toBe('dry-run');
    expect(service.isConfigured()).toBe(true);
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe('EmailService.describeDomains', () => {
  it('reports each SPF/DKIM record status, which list() alone omits', async () => {
    domainsListMock.mockResolvedValue({
      data: { data: [{ id: 'd1', name: 'acme.com', status: 'verified' }] },
      error: null,
    });
    domainsGetMock.mockResolvedValue({
      data: {
        records: [
          { type: 'TXT', name: 'send', status: 'verified' },
          { type: 'TXT', name: 'resend._domainkey', status: 'pending' },
        ],
      },
      error: null,
    });

    await expect(build().describeDomains()).resolves.toEqual([
      {
        id: 'd1',
        name: 'acme.com',
        status: 'verified',
        records: [
          { type: 'TXT', name: 'send', status: 'verified' },
          { type: 'TXT', name: 'resend._domainkey', status: 'pending' },
        ],
      },
    ]);
    expect(domainsGetMock).toHaveBeenCalledWith('d1');
  });

  it('reports a bad key as an error rather than an empty list', async () => {
    domainsListMock.mockResolvedValue({
      data: null,
      error: { message: 'API key is invalid', name: 'validation_error' },
    });
    await expect(build().describeDomains()).rejects.toThrow(
      'API key is invalid',
    );
  });
});
