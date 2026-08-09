'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { apiFetch } from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';
import { PaginatedResult, Product } from '../../../lib/types';
import { formatINR } from '../../../lib/sales';
import { useNumberFormat } from '../../../lib/number-format-context';
import { useBusinessUnitOptions } from '../../../lib/business-units';
import { Button } from '../../../components/ui/button';
import { BusinessUnitLabel } from '../../../components/ui/business-unit-label';
import { ProductForm } from '../_components/product-form';

export default function ProductsPage() {
  const { user } = useAuth();
  const { style: numberFormatStyle } = useNumberFormat();
  const canEdit = user?.role === 'MANAGER' || user?.role === 'SUPER_ADMIN';

  const [products, setProducts] = useState<Product[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [buFilter, setBuFilter] = useState('');
  const [autoOnly, setAutoOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const { businessUnits } = useBusinessUnitOptions();
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
        if (
          search &&
          !`${p.sku} ${p.name}`.toLowerCase().includes(search.toLowerCase())
        )
          return false;
        if (buFilter && p.businessUnitId !== buFilter) return false;
        if (autoOnly && !p.autoAssignedBusinessUnit) return false;
        return true;
      }),
    [products, search, buFilter, autoOnly],
  );
  const canSeeCost = products.some(
    (product) => product.rolledUpCostSnapshot !== undefined,
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

      {/* Filters apply to the products on the current page (client-side),
          matching the existing search behaviour. */}
      <div
        style={{
          marginBottom: 16,
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <input
          placeholder="Search SKU or name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: 6 }}
        />
        <select
          value={buFilter}
          onChange={(e) => setBuFilter(e.target.value)}
          style={{ padding: 6 }}
        >
          <option value="">All business units</option>
          {businessUnits.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <label
          style={{
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <input
            type="checkbox"
            checked={autoOnly}
            onChange={(e) => setAutoOnly(e.target.checked)}
          />
          Auto-assigned only (needs review)
        </label>
      </div>

      {error && <p className="text-destructive">{error}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid hsl(var(--border))' }}>
                <th>SKU</th>
                <th>Name</th>
                <th>Business Unit</th>
                <th>Unit Price</th>
                {canSeeCost && <th>Released BOM Cost</th>}
                {canSeeCost && <th>Target Margin</th>}
                {canSeeCost && <th>Actual Margin</th>}
                <th>UoM</th>
                <th>Active</th>
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid hsl(var(--border))' }}>
                  <td>{p.sku}</td>
                  <td>{p.name}</td>
                  <td>
                    <BusinessUnitLabel
                      name={p.businessUnitName}
                      colorHex={p.businessUnitColorHex}
                    />
                    {p.autoAssignedBusinessUnit && (
                      <span
                        title="Auto-assigned by inference — not yet confirmed"
                        style={{
                          marginLeft: 6,
                          fontSize: 12,
                          color: 'hsl(var(--warning))',
                        }}
                      >
                        ✨ auto
                      </span>
                    )}
                  </td>
                  <td>{formatINR(p.unitPrice, numberFormatStyle)}</td>
                  {canSeeCost && (
                    <td>
                      {p.rolledUpCostSnapshot == null
                        ? '—'
                        : formatINR(p.rolledUpCostSnapshot, numberFormatStyle)}
                    </td>
                  )}
                  {canSeeCost && (
                    <td>
                      {p.targetMarginPercent == null
                        ? '—'
                        : `${Number(p.targetMarginPercent).toFixed(2)}%`}
                    </td>
                  )}
                  {canSeeCost && (
                    <td>
                      {p.actualMarginPercent == null
                        ? '—'
                        : `${Number(p.actualMarginPercent).toFixed(2)}%`}
                    </td>
                  )}
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
                  <td
                    colSpan={(canEdit ? 7 : 6) + (canSeeCost ? 3 : 0)}
                    style={{ padding: 12, color: 'hsl(var(--muted-foreground))' }}
                  >
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
