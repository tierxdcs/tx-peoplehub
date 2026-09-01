import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'opp-1' }) }));
vi.mock('../../../../../lib/business-units', () => ({
  businessUnitOptions: () => Promise.resolve([{ id: 'bu-1', name: 'Phaze' }]),
}));
vi.mock('../../../../../lib/vault-api', () => ({
  uploadToPresignedUrl: vi.fn(),
}));
vi.mock('../../../../../components/ui/toaster', () => ({
  useToast: () => ({ toast: vi.fn(), success: vi.fn(), error: vi.fn() }),
}));

const createCustomerBomIntake = vi.fn();
vi.mock('../../../../../lib/customer-bom-intake', () => ({
  listCustomerBomIntakes: () => Promise.resolve([]),
  // Every fuzzy match scores the same, which is exactly why the UI has to say
  // which one the user picked rather than relying on a radio dot.
  findCustomerBomMatches: () =>
    Promise.resolve([
      {
        id: 'item-6',
        itemCode: 'CM-00006',
        name: 'Liquid Cooling 1',
        score: 0.4,
      },
      {
        id: 'item-7',
        itemCode: 'CM-00007',
        name: 'Liquid Cooling 2',
        score: 0.4,
      },
    ]),
  createCustomerBomIntake: (...args: unknown[]) =>
    createCustomerBomIntake(...args),
  customerBomUploadUrl: vi.fn(),
}));

import Page from './page';

/** Fill the header + first line and run the Item Master search. */
async function renderSearched() {
  render(<Page />);
  // The page loads business units and past intakes on mount, and the search
  // itself resolves a promise, so both settle via waitFor.
  await waitFor(() => screen.getByRole('option', { name: 'Phaze' }));

  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'bu-1' } });
  const textboxes = screen.getAllByRole('textbox');
  fireEvent.change(textboxes[0], { target: { value: 'Liquid Cooling Unit' } });
  fireEvent.change(textboxes[2], { target: { value: 'liquid' } });
  fireEvent.click(screen.getByRole('button', { name: /Search/ }));

  await waitFor(() => screen.getByRole('radio', { name: /CM-00006/ }));
}

const submitButton = () =>
  screen.getByRole('button', {
    name: /Create Product & Draft BOM/,
  }) as HTMLButtonElement;

const candidateList = () => screen.queryByText('Candidate Item Master matches');

beforeEach(() => createCustomerBomIntake.mockReset().mockResolvedValue({}));

describe('customer BOM intake — resolving a line', () => {
  it('closes the search and names the match once a candidate is picked', async () => {
    await renderSearched();

    fireEvent.click(screen.getByRole('radio', { name: /CM-00006/ }));

    expect(candidateList()).toBeNull();
    expect(screen.getByText(/Matched to/).textContent).toContain('CM-00006');
    expect(submitButton().disabled).toBe(false);
  });

  it('sends the picked item, not a new-item request', async () => {
    await renderSearched();
    fireEvent.click(screen.getByRole('radio', { name: /CM-00007/ }));
    fireEvent.click(submitButton());

    await waitFor(() => expect(createCustomerBomIntake).toHaveBeenCalled());
    const [, payload] = createCustomerBomIntake.mock.calls[0] as [
      string,
      { lines: Array<{ existingItemId?: string; confirmCreateNew: boolean }> },
    ];
    expect(payload.lines[0].existingItemId).toBe('item-7');
    expect(payload.lines[0].confirmCreateNew).toBe(false);
  });

  it('reopens the same search on Change, with the pick still selected', async () => {
    await renderSearched();
    fireEvent.click(screen.getByRole('radio', { name: /CM-00006/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Change' }));

    expect(candidateList()).not.toBeNull();
    expect(
      (screen.getByRole('radio', { name: /CM-00006/ }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    // Re-clicking the selected radio fires no change event, so Cancel is the
    // only way back to the collapsed state.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(candidateList()).toBeNull();
    expect(submitButton().disabled).toBe(false);
  });

  it('collapses to its own summary when creating a new item', async () => {
    await renderSearched();

    fireEvent.click(screen.getByRole('radio', { name: /None of these match/ }));

    expect(candidateList()).toBeNull();
    expect(screen.getByText(/New Component item will be created/)).toBeTruthy();
    expect(submitButton().disabled).toBe(false);
  });

  it('drops the resolution when the description is edited again', async () => {
    await renderSearched();
    fireEvent.click(screen.getByRole('radio', { name: /CM-00006/ }));

    fireEvent.change(screen.getAllByRole('textbox')[2], {
      target: { value: 'liquid cooler' },
    });

    // Nothing resolved and nothing open: the line needs a fresh search.
    expect(candidateList()).toBeNull();
    expect(screen.queryByText(/Matched to/)).toBeNull();
    expect(submitButton().disabled).toBe(true);
  });
});
