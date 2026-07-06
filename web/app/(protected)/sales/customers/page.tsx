'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { apiFetch, ApiError } from '../../../lib/api';
import { Customer, PaginatedResult } from '../../../lib/types';
import { badgeStyle } from '../../../lib/sales';
import { Button } from '../../../components/ui/button';

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
      [a.line1, a.city, a.state].filter(Boolean).join(', ') ||
      JSON.stringify(a)
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

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);
  const limit = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<PaginatedResult<Customer>>(
        `/customers?page=${page}&limit=${limit}`,
      );
      setCustomers(res.items);
      setTotal(res.total);
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

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <h1>Customer Master</h1>
        <Button onClick={() => setEditing('new')}>
          <Plus /> New Customer
        </Button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <input
          placeholder="Search name, GSTIN, industry"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: 6 }}
        />
      </div>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                <th>Name</th>
                <th>GSTIN</th>
                <th>Industry</th>
                <th>Billing</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td>{c.name}</td>
                  <td>{c.gstin ?? '—'}</td>
                  <td>{c.industry ?? '—'}</td>
                  <td>{addressLine(c.billingAddress)}</td>
                  <td>
                    <span
                      style={badgeStyle(
                        c.status === 'ACTIVE' ? '#27ae60' : '#7f8c8d',
                      )}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditing(c)}
                    >
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: 12, color: '#666' }}>
                    No customers.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Prev
            </Button>
            <span>
              Page {page} of {Math.max(1, Math.ceil(total / limit))}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page * limit >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </>
      )}

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
    </div>
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
      { name: '', email: '', phone: '', designation: '', isPrimary: cs.length === 0 },
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
      setError(err instanceof ApiError ? err.message : 'Failed to save customer');
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
          background: '#fff',
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
            Billing address (plain text or JSON with a &quot;state&quot; key for GST)
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
            <label style={{ display: 'block', marginBottom: 4 }}>Contacts</label>
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
              <span style={{ color: '#666' }}>No contacts.</span>
            )}
          </div>
        ) : (
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4 }}>Contacts</label>
            {contacts.map((c, i) => (
              <div
                key={i}
                style={{
                  border: '1px solid #eee',
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

        {error && <p style={{ color: 'crimson' }}>{error}</p>}

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
