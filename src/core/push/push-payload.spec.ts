import {
  buildPushPayload,
  classifyPushFailure,
  clampText,
  MAX_PUSH_PAYLOAD_BYTES,
} from './push-payload';

describe('clampText', () => {
  it('trims whitespace and leaves short text alone', () => {
    expect(clampText('  Approval waiting  ', 50)).toBe('Approval waiting');
  });

  it('marks text it had to cut', () => {
    const result = clampText('a'.repeat(30), 10);
    expect(result).toHaveLength(10);
    expect(result.endsWith('…')).toBe(true);
  });
});

describe('buildPushPayload', () => {
  const parse = (json: string) => JSON.parse(json) as Record<string, unknown>;

  it('carries the title, body and tap target', () => {
    const payload = parse(
      buildPushPayload({
        title: 'New ping',
        body: 'Asha sent you a ping',
        url: '/pings',
        tag: 'ping:42',
      }),
    );
    expect(payload).toMatchObject({
      title: 'New ping',
      body: 'Asha sent you a ping',
      url: '/pings',
      tag: 'ping:42',
    });
  });

  it('defaults the tap target to the dashboard', () => {
    // A notification that opens nothing reads as broken, and the service worker
    // has to navigate somewhere.
    expect(parse(buildPushPayload({ title: 'Hello' })).url).toBe('/dashboard');
  });

  it('never produces an empty title', () => {
    expect(parse(buildPushPayload({ title: '   ' })).title).toBe(
      'Notification',
    );
  });

  it('clamps a long body rather than letting the provider reject it', () => {
    const payload = parse(
      buildPushPayload({ title: 'Long', body: 'x'.repeat(2000) }),
    );
    expect((payload.body as string).length).toBeLessThanOrEqual(400);
  });

  it('drops data before it drops the message', () => {
    const payload = parse(
      buildPushPayload({
        title: 'Big',
        body: 'still readable',
        data: { blob: 'y'.repeat(4000) },
      }),
    );
    expect(payload.data).toBeUndefined();
    expect(payload.title).toBe('Big');
    expect(payload.body).toBe('still readable');
  });

  it('always fits inside the push service payload budget', () => {
    const json = buildPushPayload({
      title: 'z'.repeat(500),
      body: 'z'.repeat(5000),
      data: { a: 'z'.repeat(5000) },
      url: '/dashboard',
    });
    expect(Buffer.byteLength(json, 'utf8')).toBeLessThanOrEqual(
      MAX_PUSH_PAYLOAD_BYTES,
    );
  });
});

describe('classifyPushFailure', () => {
  it('treats 404 and 410 as permanently gone', () => {
    // These are the two statuses that mean "delete the row" — retrying them
    // forever is the classic Web Push leak.
    expect(classifyPushFailure(404)).toBe('expired');
    expect(classifyPushFailure(410)).toBe('expired');
  });

  it('treats auth and payload errors as our own misconfiguration', () => {
    expect(classifyPushFailure(400)).toBe('rejected');
    expect(classifyPushFailure(401)).toBe('rejected');
    expect(classifyPushFailure(403)).toBe('rejected');
    expect(classifyPushFailure(413)).toBe('rejected');
  });

  it('treats anything else, including no status at all, as transient', () => {
    expect(classifyPushFailure(429)).toBe('failed');
    expect(classifyPushFailure(500)).toBe('failed');
    expect(classifyPushFailure(undefined)).toBe('failed');
  });
});
