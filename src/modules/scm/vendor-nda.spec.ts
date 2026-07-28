import { requiresSignedNda } from './scm.service';

describe('vendor NDA onboarding rule', () => {
  it('requires a signed NDA only on the first questionnaire revision', () => {
    expect(requiresSignedNda(1)).toBe(true);
    expect(requiresSignedNda(2)).toBe(false);
    expect(requiresSignedNda(3)).toBe(false);
  });
});
