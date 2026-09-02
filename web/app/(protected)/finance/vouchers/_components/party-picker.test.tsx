import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PartyPicker } from './party-picker';

const options = [
  { id: 'ord-10', label: 'ORD-2026-0010', sublabel: 'Dhanur Teck Solutions' },
  { id: 'ord-1', label: 'ORD-2026-0001', sublabel: 'Global Networks Pvt. Ltd' },
];

function open(onChange = vi.fn()) {
  render(<PartyPicker options={options} value="" onChange={onChange} />);
  const input = screen.getByRole('textbox');
  fireEvent.focus(input);
  return { input, onChange };
}

describe('PartyPicker', () => {
  it('opens the list on focus', () => {
    open();
    expect(screen.getByRole('option', { name: /ORD-2026-0010/ })).toBeTruthy();
  });

  it('selects a clicked option and collapses to it', () => {
    const { onChange } = open();

    fireEvent.click(screen.getByRole('option', { name: /ORD-2026-0010/ }));

    expect(onChange).toHaveBeenCalledWith('ord-10');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  /**
   * The regression this component was reported for: pressing an option used to
   * blur the search input, which tore the list down on a timer. A click held
   * longer than that timer never reached the option, so the field silently
   * refused to select anything.
   */
  it('keeps the list open while an option is being pressed', () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      render(<PartyPicker options={options} value="" onChange={onChange} />);
      fireEvent.focus(screen.getByRole('textbox'));
      const option = screen.getByRole('option', { name: /ORD-2026-0010/ });

      // Pressing an option must not move focus — that focus change is what
      // used to start the teardown.
      expect(fireEvent.mouseDown(option)).toBe(false);
      // A deliberate press, far longer than the old 100ms teardown delay.
      vi.advanceTimersByTime(1000);

      expect(screen.getByRole('listbox')).toBeTruthy();
      fireEvent.click(option);
      expect(onChange).toHaveBeenCalledWith('ord-10');
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes on a mousedown outside the field', () => {
    open();
    expect(screen.getByRole('listbox')).toBeTruthy();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes on Escape and selects the top match on Enter', () => {
    const { input, onChange } = open();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();

    // Typing reopens without needing to re-focus — Escape left focus in place.
    fireEvent.change(input, { target: { value: 'global' } });
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith('ord-1');
  });

  it('says so when nothing matches, rather than looking like a dead field', () => {
    const { input } = open();

    fireEvent.change(input, { target: { value: 'ORD-9999' } });

    expect(screen.getByRole('listbox').textContent).toMatch(/No matches/);
  });

  it('shows the chosen option once the parent has stored it', () => {
    render(<PartyPicker options={options} value="ord-1" onChange={vi.fn()} />);
    expect(screen.getByText('ORD-2026-0001')).toBeTruthy();
    expect(screen.getByText('Change')).toBeTruthy();
  });
});
