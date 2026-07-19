'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { apiFetch, ApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';
import { PaginatedResult, Product } from '../../../lib/types';
import { formatINR } from '../../../lib/sales';
import { listItems, type Item } from '../../../lib/scm-item-master';
import { Button } from '../../../components/ui/button';

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: 8,
  boxSizing: 'border-box',
};

export default function ProductsPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'MANAGER' || user?.role === 'SUPER_ADMIN';

  const [products, setProducts] = useState<Product[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const limit = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<PaginatedResult<Product>>(
        `/products?page=${page}&limit=${limit}`,
      );
      setProducts(res.items);
      setTotal(res.total);
    } catch {
      setError('Failed to load products');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(
    () =>
      products.filter((p) => {
        if (!search) return true;
        return `${p.sku} ${p.name}`
          .toLowerCase()
          .includes(search.toLowerCase());
      }),
    [products, search],
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
        <h1>Product Catalog</h1>
        {canEdit && (
          <Button onClick={() => setEditing('new')}>
            <Plus /> New Product
          </Button>
        )}
      </div>

      <div style={{ marginBottom: 16 }}>
        <input
          placeholder="Search SKU or name"
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
                <th>SKU</th>
                <th>Name</th>
                <th>Unit Price</th>
                <th>UoM</th>
                <th>Active</th>
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td>{p.sku}</td>
                  <td>{p.name}</td>
                  <td>{formatINR(p.unitPrice)}</td>
                  <td>{p.unitOfMeasure}</td>
                  <td>{p.isActive ? 'Yes' : 'No'}</td>
                  {canEdit && (
                    <td>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditing(p)}
                      >
                        Edit
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={canEdit ? 6 : 5} style={{ padding: 12, color: '#666' }}>
                    No products.
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
        <ProductForm
          product={editing === 'new' ? null : editing}
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

function ProductForm({
  product,
  onClose,
  onSaved,
}: {
  product: Product | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = product !== null;
  const [sku, setSku] = useState(product?.sku ?? '');
  const [name, setName] = useState(product?.name ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [unitPrice, setUnitPrice] = useState(product?.unitPrice ?? '');
  const [unitOfMeasure, setUnitOfMeasure] = useState(
    product?.unitOfMeasure ?? 'each',
  );
  const [hsnCode, setHsnCode] = useState(product?.hsnCode ?? '');
  const [isActive, setIsActive] = useState(product?.isActive ?? true);
  const [itemId, setItemId] = useState(product?.itemId ?? '');
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Item Master items for the "manufactured item" link (active only). Best-
  // effort — a fetch failure just leaves the picker empty (link stays optional).
  useEffect(() => {
    listItems({ activeOnly: true })
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name || !unitOfMeasure || unitPrice === '') {
      setError('Name, unit price and unit of measure are required');
      return;
    }
    setSubmitting(true);
    try {
      if (isEdit) {
        await apiFetch(`/products/${product!.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name,
            description: description || undefined,
            unitPrice: Number(unitPrice),
            unitOfMeasure,
            hsnCode: hsnCode || undefined,
            isActive,
            // '' → null (unlink); an id → link. Always sent so edits can clear it.
            itemId: itemId || null,
          }),
        });
      } else {
        await apiFetch('/products', {
          method: 'POST',
          body: JSON.stringify({
            sku,
            name,
            description: description || undefined,
            unitPrice: Number(unitPrice),
            unitOfMeasure,
            hsnCode: hsnCode || undefined,
            isActive,
            itemId: itemId || undefined,
          }),
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save product');
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
        style={{ background: '#fff', padding: 24, borderRadius: 6, width: 400 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{isEdit ? 'Edit Product' : 'New Product'}</h2>
        {!isEdit && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4 }}>SKU</label>
            <input
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              required
              style={fieldStyle}
            />
          </div>
        )}
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
          <label style={{ display: 'block', marginBottom: 4 }}>Description</label>
          <textarea
            value={description ?? ''}
            onChange={(e) => setDescription(e.target.value)}
            style={{ ...fieldStyle, minHeight: 50 }}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>Unit price</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
            required
            style={fieldStyle}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>
            Unit of measure
          </label>
          <input
            value={unitOfMeasure}
            onChange={(e) => setUnitOfMeasure(e.target.value)}
            required
            style={fieldStyle}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>
            HSN code (optional)
          </label>
          <input
            value={hsnCode ?? ''}
            onChange={(e) => setHsnCode(e.target.value)}
            style={fieldStyle}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>
            Manufactured item (optional)
          </label>
          <select
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
            style={fieldStyle}
          >
            <option value="">— Not linked —</option>
            {items.map((it) => (
              <option key={it.id} value={it.id}>
                {it.itemCode} — {it.name}
              </option>
            ))}
          </select>
          <p style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
            Link to the Item Master item this product is built as. Required for
            its BOM and the project-kickoff stock-availability report.
          </p>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label>
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />{' '}
            Active
          </label>
        </div>

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
