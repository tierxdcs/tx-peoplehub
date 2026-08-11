'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../../lib/api';
import {
  createCategory,
  listCategories,
  listExpenseLedgers,
  updateCategory,
  type ExpenseCategory,
  type ExpenseLedgerOption,
} from '../../../lib/expense-claims';
import { useToast } from '../../../components/ui/toaster';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Switch } from '../../../components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';

export default function ExpenseCategoriesSettingsPage() {
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [ledgers, setLedgers] = useState<ExpenseLedgerOption[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [ledgerId, setLedgerId] = useState('');
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const [cats, leds] = await Promise.all([
        listCategories(),
        listExpenseLedgers(),
      ]);
      setCategories(cats);
      setLedgers(leds);
    } catch {
      toast.error('Failed to load expense categories');
    }
  }, [toast]);
  useEffect(() => {
    void load();
  }, [load]);

  function resetForm() {
    setEditingId(null);
    setName('');
    setLedgerId('');
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !ledgerId) return;
    setSaving(true);
    try {
      if (editingId) {
        await updateCategory(editingId, {
          name: name.trim(),
          defaultExpenseLedgerId: ledgerId,
        });
        toast.success('Category updated');
      } else {
        await createCategory({
          name: name.trim(),
          defaultExpenseLedgerId: ledgerId,
        });
        toast.success('Category added');
      }
      resetForm();
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function edit(c: ExpenseCategory) {
    setEditingId(c.id);
    setName(c.name);
    setLedgerId(c.defaultExpenseLedgerId);
  }

  async function toggle(c: ExpenseCategory) {
    try {
      await updateCategory(c.id, { isActive: !c.isActive });
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Update failed');
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Expense Categories"
        description="The categories an employee picks for each expense-claim line. Each category maps to the expense ledger its lines debit when the claim is approved. Deactivating a category hides it from new claims without affecting claims already raised."
      />

      <Card className="mb-4">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead>Posts to ledger</TableHead>
                <TableHead className="w-24">Active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="text-center text-muted-foreground"
                  >
                    No expense categories yet.
                  </TableCell>
                </TableRow>
              ) : (
                categories.map((c) => (
                  <TableRow key={c.id} className={c.isActive ? '' : 'opacity-60'}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>
                      {c.ledgerCode} · {c.ledgerName}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={c.isActive}
                        onCheckedChange={() => toggle(c)}
                        aria-label={`Toggle ${c.name}`}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => edit(c)}>
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{editingId ? 'Edit category' : 'Add category'}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
            <label className="text-sm font-medium">
              Category name
              <Input
                className="mt-1"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
            <label className="text-sm font-medium">
              Posting ledger
              <Select
                className="mt-1"
                value={ledgerId}
                onChange={(e) => setLedgerId(e.target.value)}
                required
              >
                <option value="" disabled>
                  Select an expense ledger…
                </option>
                {ledgers.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code} · {l.name}
                  </option>
                ))}
              </Select>
            </label>
            <div className="flex gap-2 md:col-span-2">
              <Button type="submit" disabled={saving}>
                {editingId ? 'Save changes' : 'Add category'}
              </Button>
              {editingId && (
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
