import { describe, expect, it } from 'vitest';
import {
  filterAndGroupItems,
  type ItemPickerItem,
  recentItems,
} from './item-picker';

const items = [
  ['fg', 'FG-001', 'Finished Rack', 'FINISHED_GOOD'],
  ['sa', 'SA-001', 'Door Assembly', 'SUBASSEMBLY'],
  ['cm', 'CM-001', 'Lock', 'COMPONENT'],
  ['rm', 'RM-001', 'Steel Sheet', 'RAW_MATERIAL'],
  ['cn', 'CN-001', 'Welding Wire', 'CONSUMABLE'],
].map(
  ([id, itemCode, name, itemType]) =>
    ({
      id,
      itemCode,
      name,
      itemType,
      isActive: true,
    }) as ItemPickerItem,
);

describe('ItemPicker ordering and search', () => {
  it('filters by item code and item name', () => {
    expect(filterAndGroupItems(items, 'CM-001').flatMap((g) => g.items)).toHaveLength(1);
    expect(filterAndGroupItems(items, 'steel').flatMap((g) => g.items)[0]?.id).toBe('rm');
  });

  it('groups all item types with the BOM component bias but retains finished goods', () => {
    const groups = filterAndGroupItems(items, '', 'bom-component');
    expect(groups.map((group) => group.itemType)).toEqual([
      'SUBASSEMBLY',
      'COMPONENT',
      'RAW_MATERIAL',
      'CONSUMABLE',
      'FINISHED_GOOD',
    ]);
    expect(groups.at(-1)?.items[0].id).toBe('fg');
  });

  it('returns recent items in recency order and ignores stale ids', () => {
    expect(recentItems(items, ['cm', 'missing', 'fg']).map((item) => item.id)).toEqual([
      'cm',
      'fg',
    ]);
  });
});
