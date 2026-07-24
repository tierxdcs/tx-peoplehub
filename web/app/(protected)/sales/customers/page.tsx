'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { apiFetch, ApiError } from '../../../lib/api';
import { Customer, PaginatedResult } from '../../../lib/types';
import { Button } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Skeleton } from '../../../components/ui/skeleton';
import { StatusBadge } from '../../../components/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: 8,
  boxSizing: 'border-box',
};

/** Address stored as JSON or string — render readably in the table. */
function addressLine(addr: unknown): string {
  if (!addr) return '—';
  if (typeof addr === 'string') return addr;
  if (typeof addr === 'object') {
    const a = addr as Record<string, unknown>;
    return (
      [a.line1, a.city, a.state].filter(Boolean).join(', ') || JSON.stringify(a)
    );
  }
  return String(addr);
}

interface ContactDraft {
  name: string;
  email: string;
  phone: string;
  designation: string;
  isPrimary: boolean;
}

const PAGE_SIZE = 20;

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card className="min-w-[160px] flex-1">
      <CardContent className="p-4">
        <div className="text-sm font-medium text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [summaryRows, setSummaryRows] = useState<Customer[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<PaginatedResult<Customer>>(
        `/customers?page=${page}&limit=${PAGE_SIZE}`,
      );
      setCustomers(res.items);
      setTotal(res.total);
      if (page === 1 && res.total <= res.items.length) {
        setSummaryRows(res.items);
      } else {
        const summary = await apiFetch<PaginatedResult<Customer>>(
          '/customers?page=1&limit=100',
        );
        setSummaryRows(summary.items);
      }
    } catch {
      setError('Failed to load customers');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(
    () =>
      customers.filter((c) => {
        if (!search) return true;
        return `${c.name} ${c.gstin ?? ''} ${c.industry ?? ''}`
          .toLowerCase()
          .includes(search.toLowerCase());
      }),
    [customers, search],
  );

  const summary = useMemo(
    () => ({
      active: summaryRows.filter((customer) => customer.status === 'ACTIVE')
        .length,
      gstRegistered: summaryRows.filter((customer) => Boolean(customer.gstin))
        .length,
      industries: new Set(
        summaryRows
          .map((customer) => customer.industry?.trim())
          .filter((industry): industry is string => Boolean(industry)),
      ).size,
    }),
    [summaryRows],
  );

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <PageContainer>
      <PageHeader
        title="Customer Master"
        description="Maintain customer identity, GST registration, addresses and contacts in one register."
        action={
          <Button onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" /> New Customer
          </Button>
        }
      />

      <div className="mb-6 flex flex-wrap gap-3">
        <StatCard label="Total Customers" value={total} />
        <StatCard label="Active" value={summary.active} />
        <StatCard label="GST Registered" value={summary.gstRegistered} />
        <StatCard label="Industries" value={summary.industries} />
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-semibold">Customer Register</h2>
        <input
          aria-label="Search customers"
          placeholder="Search name, GSTIN, industry"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring sm:w-72"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>GSTIN</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Billing Address</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, row) => (
                  <TableRow key={row}>
                    {Array.from({ length: 6 }).map((__, column) => (
                      <TableCell key={column}>
                        <Skeleton className="h-4 w-24" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-8 text-center text-muted-foreground"
                  >
                    {search
                      ? 'No customers match your search on this page.'
                      : 'No customers yet.'}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((customer) => (
                  <TableRow key={customer.id}>
                    <TableCell className="font-medium">
                      {customer.name}
                    </TableCell>
                    <TableCell>{customer.gstin ?? '—'}</TableCell>
                    <TableCell>{customer.industry ?? '—'}</TableCell>
                    <TableCell className="max-w-[320px] truncate">
                      {addressLine(customer.billingAddress)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge value={customer.status} />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditing(customer)}
                      >
                        Edit Customer
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="mt-4 flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1 || loading}
          onClick={() => setPage((current) => current - 1)}
        >
          Previous
        </Button>
        <span className="text-sm text-muted-foreground">
          Page {page} of {pageCount}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pageCount || loading}
          onClick={() => setPage((current) => current + 1)}
        >
          Next
        </Button>
      </div>

      {editing && (
        <CustomerForm
          customer={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </PageContainer>
  );
}

function CustomerForm({
  customer,
  onClose,
  onSaved,
}: {
  customer: Customer | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = customer !== null;
  const [name, setName] = useState(customer?.name ?? '');
  const [gstin, setGstin] = useState(customer?.gstin ?? '');
  const [industry, setIndustry] = useState(customer?.industry ?? '');
  const [billing, setBilling] = useState(
    typeof customer?.billingAddress === 'string'
      ? customer.billingAddress
      : customer?.billingAddress
        ? JSON.stringify(customer.billingAddress)
        : '',
  );
  const [shipping, setShipping] = useState(
    typeof customer?.shippingAddress === 'string'
      ? customer.shippingAddress
      : customer?.shippingAddress
        ? JSON.stringify(customer.shippingAddress)
        : '',
  );
  const [status, setStatus] = useState(customer?.status ?? 'ACTIVE');
  const [contacts, setContacts] = useState<ContactDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /** Parse an address field: JSON object if it looks like one, else the raw string. */
  function parseAddress(raw: string): Record<string, unknown> | string {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{')) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return raw;
      }
    }
    return raw;
  }

  function addContact() {
    setContacts((cs) => [
      ...cs,
      {
        name: '',
        email: '',
        phone: '',
        designation: '',
        isPrimary: cs.length === 0,
      },
    ]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name || !billing.trim()) {
      setError('Name and billing address are required');
      return;
    }
    setSubmitting(true);
    try {
      if (isEdit) {
        await apiFetch(`/customers/${customer!.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name,
            gstin: gstin || undefined,
            industry: industry || undefined,
            billingAddress: parseAddress(billing),
            shippingAddress: shipping ? parseAddress(shipping) : undefined,
            status,
          }),
        });
      } else {
        await apiFetch('/customers', {
          method: 'POST',
          body: JSON.stringify({
            name,
            gstin: gstin || undefined,
            industry: industry || undefined,
            billingAddress: parseAddress(billing),
            shippingAddress: shipping ? parseAddress(shipping) : undefined,
            contacts: contacts
              .filter((c) => c.name.trim())
              .map((c) => ({
                name: c.name,
                email: c.email || undefined,
                phone: c.phone || undefined,
                designation: c.designation || undefined,
                isPrimary: c.isPrimary,
              })),
          }),
        });
      }
      onSaved();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Failed to save customer',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: 'hsl(var(--card))',
          padding: 24,
          borderRadius: 6,
          width: 460,
          maxHeight: '85vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{isEdit ? 'Edit Customer' : 'New Customer'}</h2>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            style={fieldStyle}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>GSTIN</label>
          <input
            value={gstin ?? ''}
            onChange={(e) => setGstin(e.target.value)}
            style={fieldStyle}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>Industry</label>
          <input
            value={industry ?? ''}
            onChange={(e) => setIndustry(e.target.value)}
            style={fieldStyle}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>
            Billing address (plain text or JSON with a &quot;state&quot; key for
            GST)
          </label>
          <textarea
            value={billing}
            onChange={(e) => setBilling(e.target.value)}
            style={{ ...fieldStyle, minHeight: 50 }}
            placeholder='{"line1":"...","city":"...","state":"Karnataka"}'
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>
            Shipping address (optional — defaults to billing)
          </label>
          <textarea
            value={shipping}
            onChange={(e) => setShipping(e.target.value)}
            style={{ ...fieldStyle, minHeight: 50 }}
          />
        </div>

        {isEdit && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4 }}>Status</label>
            <select
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as 'ACTIVE' | 'INACTIVE')
              }
              style={fieldStyle}
            >
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </div>
        )}

        {/* Contacts: editable only at create time (backend PATCH doesn't
            manage contacts); existing ones are shown read-only on edit. */}
        {isEdit ? (
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4 }}>
              Contacts
            </label>
            {customer!.contacts && customer!.contacts.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {customer!.contacts.map((c) => (
                  <li key={c.id}>
                    {c.name}
                    {c.isPrimary ? ' (primary)' : ''}
                    {c.email ? ` — ${c.email}` : ''}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-muted-foreground">No contacts.</span>
            )}
          </div>
        ) : (
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4 }}>
              Contacts
            </label>
            {contacts.map((c, i) => (
              <div
                key={i}
                style={{
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 4,
                  padding: 8,
                  marginBottom: 8,
                }}
              >
                <input
                  placeholder="Name"
                  value={c.name}
                  onChange={(e) =>
                    setContacts((cs) =>
                      cs.map((x, j) =>
                        j === i ? { ...x, name: e.target.value } : x,
                      ),
                    )
                  }
                  style={{ ...fieldStyle, marginBottom: 4 }}
                />
                <input
                  placeholder="Email"
                  value={c.email}
                  onChange={(e) =>
                    setContacts((cs) =>
                      cs.map((x, j) =>
                        j === i ? { ...x, email: e.target.value } : x,
                      ),
                    )
                  }
                  style={{ ...fieldStyle, marginBottom: 4 }}
                />
                <label style={{ fontSize: 13 }}>
                  <input
                    type="radio"
                    name="primaryContact"
                    checked={c.isPrimary}
                    onChange={() =>
                      setContacts((cs) =>
                        cs.map((x, j) => ({ ...x, isPrimary: j === i })),
                      )
                    }
                  />{' '}
                  Primary
                </label>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addContact}
            >
              + Add contact
            </Button>
          </div>
        )}

        {error && <p className="text-destructive">{error}</p>}

        <div style={{ display: 'flex', gap: 8 }}>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save'}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
