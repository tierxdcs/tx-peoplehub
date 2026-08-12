import { fuzzyItemScore } from './customer-bom-intake.service';

describe('Customer BOM intake fuzzy matching', () => {
  it('matches reordered technical wording', () => {
    expect(
      fuzzyItemScore('stainless steel mounting bracket', 'Mounting bracket, stainless steel'),
    ).toBe(1);
  });

  it('does not present unrelated items as likely matches', () => {
    expect(fuzzyItemScore('copper busbar', 'powder coated enclosure')).toBe(0);
  });
});
