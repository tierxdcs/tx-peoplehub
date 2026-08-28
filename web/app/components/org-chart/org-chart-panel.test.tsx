import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompanyOrgChart, OrgChartNode } from '../../lib/org-chart';

// The panel's only collaborator is the org-chart endpoint.
const apiFetch = vi.fn();
vi.mock('../../lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

import { OrgChartPanel } from './org-chart-panel';

function person(
  id: string,
  fullName: string,
  designation: string,
  verticalName: string,
  reportingManagerId: string | null,
): OrgChartNode {
  const [firstName, lastName] = fullName.split(' ');
  return {
    id,
    employeeId: `EMP-${id}`,
    firstName,
    lastName: lastName ?? '',
    fullName,
    designation,
    verticalName,
    email: `${id}@example.com`,
    reportingManagerId,
    directReportCount: 0,
    photoUrl: null,
  };
}

/**
 *   Asha Rao (CEO)
 *   ├── Bela Nair (Operations) ── Chetan Kaur, Divya Iyer
 *   ├── Esha Shah (Sales) ── Farhan Ali
 *   └── Gita Menon (People) ── Hari Bose ── Iris Dev      <- Gita is the viewer
 */
const CHART: CompanyOrgChart = {
  nodes: [
    person('ceo', 'Asha Rao', 'Chief Executive', 'Executive', null),
    person('ops', 'Bela Nair', 'Head of Operations', 'Operations', 'ceo'),
    person('ops1', 'Chetan Kaur', 'Analyst', 'Operations', 'ops'),
    person('ops2', 'Divya Iyer', 'Coordinator', 'Operations', 'ops'),
    person('sales', 'Esha Shah', 'Sales Director', 'Sales', 'ceo'),
    person('sales1', 'Farhan Ali', 'Account Executive', 'Sales', 'sales'),
    person('ppl', 'Gita Menon', 'People Lead', 'People', 'ceo'),
    person('ppl1', 'Hari Bose', 'Recruiter', 'People', 'ppl'),
    person('ppl2', 'Iris Dev', 'Sourcer', 'People', 'ppl1'),
  ],
  rootIds: ['ceo'],
};

const card = (name: string, title: string) =>
  screen.getByRole('button', { name: `${name}, ${title}` });

async function renderPanel() {
  apiFetch.mockResolvedValue(CHART);
  render(<OrgChartPanel meId="ppl" />);
  await waitFor(() => card('Asha Rao', 'Chief Executive'));
}

function search(text: string) {
  fireEvent.change(
    screen.getByLabelText('Search the org chart by name, role or department'),
    { target: { value: text } },
  );
}

beforeEach(() => {
  apiFetch.mockReset();
});

describe('OrgChartPanel', () => {
  it('opens on the viewer with their reporting line, and folds deeper managers', async () => {
    await renderPanel();

    // Four levels: Asha › Gita › Hari › Iris.
    expect(
      screen.getByText('9 people · 4 levels · viewing Gita Menon'),
    ).toBeTruthy();
    expect(screen.getByText('Reports to Asha Rao')).toBeTruthy();

    // Hari (depth 2, has a report) starts folded, so Iris is off the canvas.
    expect(
      screen.getByRole('button', {
        name: "Expand Hari Bose's team (1 hidden)",
      }),
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Iris Dev, Sourcer' }),
    ).toBeNull();
  });

  it('collapses and expands a mid-tree node, swapping the pill to the hidden headcount', async () => {
    await renderPanel();

    expect(card('Chetan Kaur', 'Analyst')).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', {
        name: "Collapse Bela Nair's team (2 direct)",
      }),
    );

    expect(
      screen.queryByRole('button', { name: 'Chetan Kaur, Analyst' }),
    ).toBeNull();
    const pill = screen.getByRole('button', {
      name: "Expand Bela Nair's team (2 hidden)",
    });
    expect(pill.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(pill);
    expect(card('Chetan Kaur', 'Analyst')).toBeTruthy();
  });

  it('search dims non-matches and unfolds the path to a hit', async () => {
    await renderPanel();

    search('sourcer');

    // Iris was inside a folded subtree; searching reveals her.
    const iris = await waitFor(() => card('Iris Dev', 'Sourcer'));
    expect(iris.parentElement?.className).not.toContain('opacity-30');
    expect(
      card('Esha Shah', 'Sales Director').parentElement?.className,
    ).toContain('opacity-30');
  });

  it('shows an empty state when nothing matches', async () => {
    await renderPanel();
    search('zzzz');
    expect(screen.getByText(/No one matches/)).toBeTruthy();
  });

  it('opens the detail drawer and navigates to a direct report from it', async () => {
    await renderPanel();

    fireEvent.click(card('Gita Menon', 'People Lead'));
    const drawer = screen.getByLabelText('Gita Menon details');
    expect(within(drawer).getByText('EMP-ppl')).toBeTruthy();

    fireEvent.click(within(drawer).getByRole('button', { name: /Hari Bose/ }));

    expect(screen.getByLabelText('Hari Bose details')).toBeTruthy();
    expect(screen.getByText('Reports to Gita Menon')).toBeTruthy();
  });

  it('closes the drawer on Escape', async () => {
    await renderPanel();
    fireEvent.click(card('Asha Rao', 'Chief Executive'));
    expect(screen.getByLabelText('Asha Rao details')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByLabelText('Asha Rao details')).toBeNull();
  });

  it('says so when the selected person is at the top of the structure', async () => {
    await renderPanel();
    fireEvent.click(card('Asha Rao', 'Chief Executive'));
    expect(
      screen.getByText('Top of the structure — no manager above.'),
    ).toBeTruthy();
  });

  it('jumps back to the viewer from a deep selection', async () => {
    await renderPanel();

    fireEvent.click(
      screen.getByRole('button', {
        name: "Expand Hari Bose's team (1 hidden)",
      }),
    );
    fireEvent.click(card('Iris Dev', 'Sourcer'));
    expect(screen.getByText('Reports to Hari Bose')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Jump to me/ }));
    expect(screen.getByText('Reports to Asha Rao')).toBeTruthy();
    expect(screen.getByText(/viewing Gita Menon/)).toBeTruthy();
  });

  it('expands and collapses the whole tree from the toolbar', async () => {
    await renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(card('Iris Dev', 'Sourcer')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));
    // Only the root stays open, so its three reports remain and nothing deeper.
    expect(card('Bela Nair', 'Head of Operations')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Chetan Kaur, Analyst' }),
    ).toBeNull();
  });

  it('marks the viewer with a YOU chip on the card and in the strip', async () => {
    await renderPanel();
    expect(screen.getAllByText('You').length).toBe(2);
  });

  it('reports a failed load instead of an empty canvas', async () => {
    apiFetch.mockRejectedValue(new Error('nope'));
    render(<OrgChartPanel meId="ppl" />);
    await waitFor(() =>
      expect(screen.getByText('Could not load the org chart.')).toBeTruthy(),
    );
  });
});
