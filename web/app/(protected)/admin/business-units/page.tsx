'use client';

import { useEffect, useState } from 'react';
import { BusinessUnit } from '../../../lib/types';
import {
  listBusinessUnits,
  createBusinessUnit,
  updateBusinessUnit,
} from '../../../lib/business-units';

/**
 * SUPER_ADMIN business-unit management. Create, edit, and activate/deactivate.
 * Deactivating soft-disables (hidden from the product dropdown) without breaking
 * products already tagged. Backend @Roles(SUPER_ADMIN) is the real enforcement;
 * a plain Admin reaching this page gets a 403 on write.
 */
export default function BusinessUnitsPage() {
  const [units, setUnits] = useState<BusinessUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form.
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [displayOrder, setDisplayOrder] = useState('');
  const [colorHex, setColorHex] = useState('#2563EB');
  const [submitting, setSubmitting] = useState(false);

  // Inline edit.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editOrder, setEditOrder] = useState('');
  const [editColorHex, setEditColorHex] = useState('#2563EB');

  async function load() {
    setLoading(true);
    try {
      setUnits(await listBusinessUnits());
    } catch {
      setError('Failed to load business units');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await createBusinessUnit({
        name,
        code,
        description: description || undefined,
        displayOrder: displayOrder ? Number(displayOrder) : undefined,
        colorHex,
      });
      setName('');
      setCode('');
      setDescription('');
      setDisplayOrder('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(u: BusinessUnit) {
    setEditingId(u.id);
    setEditName(u.name);
    setEditDescription(u.description ?? '');
    setEditOrder(String(u.displayOrder));
    setEditColorHex(u.colorHex);
    setError(null);
  }

  async function saveEdit(id: string) {
    setError(null);
    try {
      await updateBusinessUnit(id, {
        name: editName,
        description: editDescription || null,
        displayOrder: editOrder ? Number(editOrder) : undefined,
        colorHex: editColorHex,
      });
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    }
  }

  async function toggleActive(u: BusinessUnit) {
    setError(null);
    try {
      await updateBusinessUnit(u.id, { isActive: !u.isActive });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    }
  }

  return (
    <div>
      <h1>Business Units</h1>
      <p className="mb-4 text-muted-foreground">
        Deactivating a unit hides it from the product dropdown but keeps it on
        products already tagged with it.
      </p>

      {error && <p className="text-destructive">{error}</p>}

      {loading ? (
        <p>Loading…</p>
      ) : (
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            marginBottom: 24,
          }}
        >
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid hsl(var(--border))' }}>
              <th>Order</th>
              <th>Name</th>
              <th>Code</th>
              <th>Description</th>
              <th>Colour</th>
              <th>Active</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.id} style={{ borderBottom: '1px solid hsl(var(--border))' }}>
                {editingId === u.id ? (
                  <>
                    <td>
                      <input
                        value={editOrder}
                        onChange={(e) => setEditOrder(e.target.value)}
                        style={{ width: 50, padding: 4 }}
                      />
                    </td>
                    <td>
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        style={{ padding: 4 }}
                      />
                    </td>
                    <td>{u.code}</td>
                    <td>
                      <input
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        style={{ padding: 4, width: '100%' }}
                      />
                    </td>
                    <td>
                      <input
                        type="color"
                        value={editColorHex}
                        onChange={(e) => setEditColorHex(e.target.value)}
                      />
                    </td>
                    <td>{u.isActive ? 'Yes' : 'No'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button
                        onClick={() => saveEdit(u.id)}
                        style={{ padding: 4 }}
                      >
                        Save
                      </button>{' '}
                      <button
                        onClick={() => setEditingId(null)}
                        style={{ padding: 4 }}
                      >
                        Cancel
                      </button>
                    </td>
                  </>
                ) : (
                  <>
                    <td>{u.displayOrder}</td>
                    <td>{u.name}</td>
                    <td>{u.code}</td>
                    <td className="text-muted-foreground">{u.description ?? '—'}</td>
                    <td>
                      <span
                        style={{
                          display: 'inline-block',
                          width: 14,
                          height: 14,
                          borderRadius: 999,
                          background: u.colorHex,
                        }}
                      />{' '}
                      {u.colorHex}
                    </td>
                    <td>{u.isActive ? 'Yes' : 'No'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button
                        onClick={() => startEdit(u)}
                        style={{ padding: 4 }}
                      >
                        Edit
                      </button>{' '}
                      <button
                        onClick={() => toggleActive(u)}
                        style={{ padding: 4 }}
                      >
                        {u.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Create business unit</h2>
      <form onSubmit={handleCreate} style={{ maxWidth: 360 }}>
        <div style={{ marginBottom: 12 }}>
          <label>Label colour</label>
          <br />
          <input
            type="color"
            value={colorHex}
            onChange={(e) => setColorHex(e.target.value)}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label>Name</label>
          <br />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            style={{ width: '100%', padding: 8 }}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label>Code</label>
          <br />
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            style={{ width: '100%', padding: 8 }}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label>Description (optional)</label>
          <br />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={{ width: '100%', padding: 8 }}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label>Display order</label>
          <br />
          <input
            type="number"
            value={displayOrder}
            onChange={(e) => setDisplayOrder(e.target.value)}
            style={{ width: '100%', padding: 8 }}
          />
        </div>
        <button type="submit" disabled={submitting} style={{ padding: 8 }}>
          {submitting ? 'Creating…' : 'Create'}
        </button>
      </form>
    </div>
  );
}
