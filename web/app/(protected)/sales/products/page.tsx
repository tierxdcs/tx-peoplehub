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
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { RegisterToolbar } from '../../../components/ui/register-toolbar';
import { RegisterPagination } from '../../../components/ui/register-pagination';
import { Card, CardContent } from '../../../components/ui/card';
import { Select } from '../../../components/ui/select';
import { EmptyState } from '../../../components/ui/empty-state';
import { StatusBadge } from '../../../components/ui/status-badge';
import { PackageSearch } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';

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
    <PageContainer>
      <PageHeader
        title="Product Catalog"
        description="Products available for sales quotations and product lifecycle tracking."
        action={
          canEdit ? (
            <Button onClick={() => setEditing('new')}>
              <Plus /> New Product
            </Button>
          ) : undefined
        }
      />

      {/* Filters apply to the products on the current page (client-side),
          matching the existing search behaviour. */}
      <RegisterToolbar
        title="Product Register"
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search SKU or product name"
        filters={
          <>
            <Select
              value={buFilter}
              onChange={(e) => setBuFilter(e.target.value)}
              className="w-52"
            >
              <option value="">All business units</option>
              {businessUnits.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoOnly}
                onChange={(e) => setAutoOnly(e.target.checked)}
              />
              Auto-assigned only (needs review)
            </label>
          </>
        }
      />

      {error && <p className="text-destructive">{error}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Business Unit</TableHead>
                    <TableHead>Unit Price</TableHead>
                    {canSeeCost && <TableHead>Released BOM Cost</TableHead>}
                    {canSeeCost && <TableHead>Target Margin</TableHead>}
                    {canSeeCost && <TableHead>Actual Margin</TableHead>}
                    <TableHead>UoM</TableHead>
                    <TableHead>Active</TableHead>
                    {canEdit && <TableHead />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{p.sku}</TableCell>
                      <TableCell>{p.name}</TableCell>
                      <TableCell>
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
                      </TableCell>
                      <TableCell>
                        {formatINR(p.unitPrice, numberFormatStyle)}
                      </TableCell>
                      {canSeeCost && (
                        <TableCell>
                          {!p.isCostComplete
                            ? 'Cost data incomplete'
                            : p.rolledUpCostSnapshot == null
                              ? '—'
                              : formatINR(
                                  p.rolledUpCostSnapshot,
                                  numberFormatStyle,
                                )}
                        </TableCell>
                      )}
                      {canSeeCost && (
                        <TableCell>
                          {p.targetMarginPercent == null
                            ? '—'
                            : `${Number(p.targetMarginPercent).toFixed(2)}%`}
                        </TableCell>
                      )}
                      {canSeeCost && (
                        <TableCell>
                          {p.actualMarginPercent == null
                            ? '—'
                            : `${Number(p.actualMarginPercent).toFixed(2)}%`}
                        </TableCell>
                      )}
                      <TableCell>{p.unitOfMeasure}</TableCell>
                      <TableCell>
                        <StatusBadge
                          value={p.isActive ? 'ACTIVE' : 'INACTIVE'}
                        />
                      </TableCell>
                      {canEdit && (
                        <TableCell>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setEditing(p)}
                          >
                            Edit
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={(canEdit ? 7 : 6) + (canSeeCost ? 3 : 0)}
                        className="p-0"
                      >
                        <EmptyState
                          icon={PackageSearch}
                          title="No products match your filters"
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <RegisterPagination
            page={page}
            pageCount={Math.ceil(total / limit)}
            onPageChange={setPage}
            disabled={loading}
          />
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
    </PageContainer>
  );
}
