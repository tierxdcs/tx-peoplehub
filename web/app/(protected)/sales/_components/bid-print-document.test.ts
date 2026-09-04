import { describe, expect, it } from 'vitest';
import { proposalProductDescription } from './bid-print-document';

describe('proposalProductDescription', () => {
  it('hides legacy customer BOM intake provenance', () => {
    expect(
      proposalProductDescription(
        'Created from customer BOM intake for Yokogawa India Limited',
      ),
    ).toBeNull();
  });

  it('retains a genuine customer-facing product specification', () => {
    expect(
      proposalProductDescription('IEC sockets with lockable power cord'),
    ).toBe('IEC sockets with lockable power cord');
  });
});
