import { describe, expect, it } from 'vitest';
import { serializeSubscription, urlBase64ToUint8Array } from './push';

describe('urlBase64ToUint8Array', () => {
  it('decodes a base64url key with no padding', () => {
    // 'Hello' in base64 is 'SGVsbG8=' — base64url drops the padding, which the
    // helper has to add back or atob() throws.
    expect(Array.from(urlBase64ToUint8Array('SGVsbG8'))).toEqual([
      72, 101, 108, 108, 111,
    ]);
  });

  it('translates the url-safe alphabet back to standard base64', () => {
    // 0xFB 0xFF encodes as '+/8=' in base64 and '-_8' in base64url.
    expect(Array.from(urlBase64ToUint8Array('-_8'))).toEqual([251, 255]);
  });

  it('produces the 65 bytes a VAPID public key decodes to', () => {
    // A real key is 87 base64url chars; the applicationServerKey must be the
    // uncompressed 65-byte P-256 point or subscribe() rejects it.
    const key = `B${'A'.repeat(86)}`;
    expect(urlBase64ToUint8Array(key)).toHaveLength(65);
  });
});

describe('serializeSubscription', () => {
  it('sends the endpoint and both keys the server needs', () => {
    const subscription = {
      endpoint: 'https://push.example.com/aaa',
      toJSON: () => ({ keys: { p256dh: 'key-1', auth: 'auth-1' } }),
    } as unknown as PushSubscription;

    expect(serializeSubscription(subscription)).toMatchObject({
      endpoint: 'https://push.example.com/aaa',
      keys: { p256dh: 'key-1', auth: 'auth-1' },
    });
  });

  it('never sends undefined keys, which would fail server validation', () => {
    const subscription = {
      endpoint: 'https://push.example.com/aaa',
      toJSON: () => ({}),
    } as unknown as PushSubscription;

    expect(serializeSubscription(subscription).keys).toEqual({
      p256dh: '',
      auth: '',
    });
  });
});
