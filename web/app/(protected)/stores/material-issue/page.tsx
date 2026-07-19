'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PackageMinus, Plus, Scissors } from 'lucide-react';
import {
  listIndents,
  listIssues,
  type MaterialIndent,
  type MaterialIssueNote,
} from '../../../lib/stores';
import { listInventory, type StockBalance } from '../../../lib/scm-inventory';
import { listStores, type StoreLocation } from '../../../lib/scm-inventory';
import { dateOnlyStr } from '../../../lib/date';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { StatusBadge } from '../../../components/ui/status-badge';
import { EmptyState } from '../../../components/ui/empty-state';
import { Skeleton } from '../../../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import { IssueDialog } from './_components/issue-dialog';

/**
 * Material Issue (Stores) — pending indents with current stock and an Issue
 * action, plus recent MIN history. Short issue is available and clearly
 * distinguished from a full issue (in the dialog + in the history).
 */
export default function MaterialIssuePage() {
  const router = useRouter();
  const [indents, setIndents] = useState<MaterialIndent[]>([]);
  const [issues, setIssues] = useState<MaterialIssueNote[]>([]);
  const [balances, setBalances] = useState<StockBalance[]>([]);
  const [stores, setStores] = useState<StoreLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [issuing, setIssuing] = useState<MaterialIndent | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ind, iss, bal, st] = await Promise.all([
        listIndents(),
        listIssues(),
        listInventory(),
        listStores(),
      ]);
      setIndents(ind);
      setIssues(iss);
      setBalances(bal);
      setStores(st);
    } catch {
      setError('Failed to load material issue data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Current on-hand per item, summed across store locations.
  const stockByItem = useMemo(() => {
    const map: Record<string, number> = {};
    for (const b of balances) {
      map[b.itemId] = (map[b.itemId] ?? 0) + Number(b.onHandQuantity);
    }
    return map;
  }, [balances]);

  const pending = useMemo(
    () => indents.filter((i) => i.status === 'OPEN' || i.status === 'PARTIALLY_ISSUED'),
    [indents],
  );

  // Recent MIN history, newest first (already sorted by the API but re-sort defensively).
  const recentIssues = useMemo(
    () => [...issues].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)).slice(0, 20),
    [issues],
  );

  // An issue note is "short" if its indent is still partially issued — surfaced
  // in history so short issues stay visible as a distinct outcome.
  const indentById = useMemo(
    () => Object.fromEntries(indents.map((i) => [i.id, i])),
    [indents],
  );

  return (
    <PageContainer className="max-w-6xl">
      <PageHeader
        title="Material Issue"
        description="Issue material against pending indents. Short issues are supported."
        action={
          <Button onClick={() => router.push('/stores/material-issue/new-indent')}>
            <Plus className="size-4" /> Raise Indent
          </Button>
        }
      />

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pending Indents</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {pending.length === 0 ? (
                <EmptyState
                  icon={PackageMinus}
                  title="No pending indents"
                  description="Raise an indent to request material for issue."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Indent No.</TableHead>
                      <TableHead>Work Order / Project</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Indent Qty</TableHead>
                      <TableHead className="text-right">Outstanding</TableHead>
                      <TableHead className="text-right">Current Stock</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pending.map((ind) => {
                      const stock = stockByItem[ind.itemId] ?? 0;
                      return (
                        <TableRow key={ind.id}>
                          <TableCell
                            className="cursor-pointer font-medium text-primary"
                            onClick={() => router.push(`/stores/material-issue/${ind.id}`)}
                          >
                            {ind.indentNumber}
                          </TableCell>
                          <TableCell>{ind.projectName ?? '—'}</TableCell>
                          <TableCell>
                            <div className="font-medium">{ind.itemName}</div>
                            <div className="text-xs text-muted-foreground">{ind.itemCode}</div>
                          </TableCell>
                          <TableCell className="text-right">{ind.requestedQuantity}</TableCell>
                          <TableCell className="text-right font-medium">
                            {ind.outstandingQuantity}
                          </TableCell>
                          <TableCell className="text-right">
                            <span className={stock <= 0 ? 'text-destructive' : ''}>{stock}</span>
                          </TableCell>
                          <TableCell><StatusBadge value={ind.status} /></TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" onClick={() => setIssuing(ind)}>
                              Issue
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent Issues (MIN)</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {recentIssues.length === 0 ? (
                <EmptyState icon={PackageMinus} title="No material issued yet" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>MIN No.</TableHead>
                      <TableHead>Issued</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead>Bin</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>By</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentIssues.map((note) => {
                      const ind = indentById[note.materialIndentId];
                      // Short if the indent didn't reach fully-issued from this note's
                      // perspective; we mark ongoing partials as short.
                      const isShort = ind?.status === 'PARTIALLY_ISSUED';
                      return (
                        <TableRow key={note.id}>
                          <TableCell className="font-medium">{note.minNumber}</TableCell>
                          <TableCell>{dateOnlyStr(note.issuedAt)}</TableCell>
                          <TableCell>{note.itemName ?? note.itemCode}</TableCell>
                          <TableCell className="text-right">{note.issuedQuantity}</TableCell>
                          <TableCell>{note.binLocation ?? '—'}</TableCell>
                          <TableCell>
                            {isShort ? (
                              <Badge variant="warning" className="gap-1">
                                <Scissors className="size-3" /> Short
                              </Badge>
                            ) : (
                              <Badge variant="muted">Full</Badge>
                            )}
                          </TableCell>
                          <TableCell>{note.issuedByName ?? '—'}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {issuing && (
        <IssueDialog
          indent={issuing}
          stores={stores}
          onClose={() => setIssuing(null)}
          onIssued={() => {
            setIssuing(null);
            void load();
          }}
        />
      )}
    </PageContainer>
  );
}
