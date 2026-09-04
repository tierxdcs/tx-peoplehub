import { describe, expect, it } from 'vitest';
import { proposalProductDescription } from './bid-print-document';

describe('proposalProductDescription', () => {
  it('removes BOM-intake provenance and customer while retaining the requirement', () => {
    expect(
      proposalProductDescription(
        "Created from customer BOM intake for Yokogawa India Limited — Basic PDU's of IEC socket",
      ),
    ).toBe("Basic PDU's of IEC socket");
  });

  it('retains a genuine customer-facing product specification', () => {
    expect(
      proposalProductDescription('IEC sockets with lockable power cord'),
    ).toBe('IEC sockets with lockable power cord');
  });
});
