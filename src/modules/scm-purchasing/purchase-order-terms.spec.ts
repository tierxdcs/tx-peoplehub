import { readFileSync } from 'fs';
import { join } from 'path';
import {
  PURCHASE_ORDER_TERMS,
  PURCHASE_ORDER_TERMS_TITLE,
} from './purchase-order-terms';

/**
 * The terms are duplicated in the browser-print twin because the two halves of
 * the app share no bundle. A layout drift between the twins is cosmetic; a
 * CLAUSE drift is contractual — the party who was emailed the PDF and the party
 * handed the downloaded copy would hold different terms. So this reads the web
 * file as text and fails if the canonical list is not reproduced in it verbatim.
 */
describe('purchase-order terms twins', () => {
  const webSource = readFileSync(
    join(__dirname, '../../../web/app/lib/purchase-order-terms.ts'),
    'utf8',
  );

  it('reproduces every canonical clause in the web twin, word for word', () => {
    for (const clause of PURCHASE_ORDER_TERMS) {
      expect(webSource).toContain(clause.label);
      expect(webSource).toContain(clause.text);
    }
    expect(webSource).toContain(PURCHASE_ORDER_TERMS_TITLE);
  });

  it('carries the same number of clauses in both files', () => {
    // A clause deleted from one side only would still pass the check above.
    const webClauseCount = (webSource.match(/^\s{4}label: /gm) ?? []).length;
    expect(webClauseCount).toBe(PURCHASE_ORDER_TERMS.length);
  });

  it('states a label and a clause body for every entry', () => {
    for (const clause of PURCHASE_ORDER_TERMS) {
      expect(clause.label.trim()).not.toHaveLength(0);
      expect(clause.text.trim().length).toBeGreaterThan(20);
      // The renderers append the colon, so a label must not carry its own.
      expect(clause.label.endsWith(':')).toBe(false);
    }
  });
});
