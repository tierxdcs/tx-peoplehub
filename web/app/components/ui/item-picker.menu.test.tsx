import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ItemPicker, type ItemPickerItem } from './item-picker';

const items: ItemPickerItem[] = [
  { id: 'cm', itemCode: 'CM-001', name: 'Lock', itemType: 'COMPONENT' },
  { id: 'rm', itemCode: 'RM-001', name: 'Steel Sheet', itemType: 'RAW_MATERIAL' },
];

/** The picker's real home: a clipping card wrapping a scrolling line table. */
function renderInClippingCard(onValueChange = vi.fn()) {
  const view = render(
    <div data-testid="card" className="overflow-hidden">
      <div className="overflow-x-auto">
        <ItemPicker items={items} value="" onValueChange={onValueChange} />
      </div>
    </div>,
  );
  fireEvent.click(screen.getByRole('combobox'));
  return { ...view, onValueChange };
}

beforeEach(() => localStorage.clear());

describe('ItemPicker menu', () => {
  it('renders the menu outside the clipping card so it cannot be cut off', () => {
    renderInClippingCard();

    const menu = screen.getByRole('listbox').parentElement as HTMLElement;
    expect(screen.getByTestId('card').contains(menu)).toBe(false);
    expect(menu.parentElement).toBe(document.body);
    expect(menu.style.position).toBe('fixed');
  });

  it('stays open while you use the search box inside it', () => {
    // The outside-click handler has to hit-test the portalled menu too,
    // otherwise clicking into the search field closes the menu.
    renderInClippingCard();
    const search = screen.getByLabelText('Search items');

    fireEvent.mouseDown(search);
    fireEvent.change(search, { target: { value: 'steel' } });

    expect(screen.getByRole('option', { name: /RM-001/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /CM-001/ })).toBeNull();
  });

  it('selects an item and closes', () => {
    const { onValueChange } = renderInClippingCard();

    fireEvent.click(screen.getByRole('option', { name: /CM-001/ }));

    expect(onValueChange).toHaveBeenCalledWith('cm');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes on a click outside the picker and its menu', () => {
    renderInClippingCard();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
