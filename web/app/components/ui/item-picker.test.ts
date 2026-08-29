import { describe, expect, it } from 'vitest';
import {
  MENU_MAX_LIST_HEIGHT,
  MENU_MIN_LIST_HEIGHT,
  MENU_MIN_WIDTH,
  filterAndGroupItems,
  type ItemPickerItem,
  menuPosition,
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

describe('menuPosition', () => {
  const viewport = { width: 1440, height: 900 };
  const trigger = { top: 200, bottom: 236, left: 300, width: 240 };

  it('hangs the menu under the trigger and never narrower than the minimum', () => {
    const position = menuPosition(trigger, viewport);
    expect(position.top).toBe(240);
    expect(position.bottom).toBeNull();
    expect(position.left).toBe(300);
    expect(position.width).toBe(MENU_MIN_WIDTH);
    expect(menuPosition({ ...trigger, width: 500 }, viewport).width).toBe(500);
  });

  it('opens upwards when the trigger is near the bottom of the viewport', () => {
    // The regression this whole portal exists for: a line-item row sitting low
    // in a clipping card used to lose the list entirely.
    const position = menuPosition({ ...trigger, top: 820, bottom: 856 }, viewport);
    expect(position.top).toBeNull();
    expect(position.bottom).toBe(viewport.height - 820 + 4);
    expect(position.maxListHeight).toBeGreaterThanOrEqual(MENU_MIN_LIST_HEIGHT);
  });

  it('caps the list to the space available, down to a usable minimum', () => {
    expect(menuPosition(trigger, viewport).maxListHeight).toBe(MENU_MAX_LIST_HEIGHT);
    // A short viewport shrinks the list rather than overflowing the screen.
    const cramped = menuPosition(trigger, { width: 1440, height: 480 });
    expect(cramped.maxListHeight).toBeLessThan(MENU_MAX_LIST_HEIGHT);
    expect(cramped.maxListHeight).toBeGreaterThanOrEqual(MENU_MIN_LIST_HEIGHT);
  });

  it('pulls the menu back inside the right edge', () => {
    const position = menuPosition({ ...trigger, left: 1380 }, viewport);
    expect(position.left + position.width).toBeLessThanOrEqual(viewport.width);
    // …and never off the left edge on a narrow screen.
    expect(menuPosition(trigger, { width: 300, height: 900 }).left).toBe(8);
  });
});
