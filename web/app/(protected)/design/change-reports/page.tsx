'use client';
import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { statusVariant } from '../../../lib/status';
type C = { id: string; changeNumber: string; title: string; status: string };
type R = {
  id: string;
  reportNumber: string;
  revision: number;
  title: string;
  status: string;
  generatedAt: string;
  change: C;
};
export default function Reports() {
  const [rows, setRows] = useState<R[]>([]),
    [changes, setChanges] = useState<C[]>([]),
    [f, setF] = useState({
      changeId: '',
      title: '',
      customerSignatureRequired: false,
    });
  const load = useCallback(async () => {
    const [r, c] = await Promise.all([
      apiFetch<R[]>('/design/change-reports'),
      apiFetch<C[]>('/design/changes'),
    ]);
    setRows(r);
    setChanges(
      c.filter((x) =>
        ['APPROVED', 'IMPLEMENTING', 'CLOSED'].includes(x.status),
      ),
    );
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function create(e: FormEvent) {
    e.preventDefault();
    await apiFetch('/design/change-reports', {
      method: 'POST',
      body: JSON.stringify(f),
    });
    await load();
  }
  return (
    <PageContainer>
      <PageHeader
        title="Engineering Change Reports"
        description="Immutable ECR/ECO reports with controlled signatures and PDF output"
      />
      <Card className="mb-5">
        <CardContent className="p-5">
          <form className="grid gap-3 md:grid-cols-3" onSubmit={create}>
            <Select
              required
              value={f.changeId}
              onChange={(e) =>
                setF((x) => ({ ...x, changeId: e.target.value }))
              }
            >
              <option value="">Approved engineering change</option>
              {changes.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.changeNumber} · {x.title}
                </option>
              ))}
            </Select>
            <Input
              placeholder="Report title (optional)"
              value={f.title}
              onChange={(e) => setF((x) => ({ ...x, title: e.target.value }))}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={f.customerSignatureRequired}
                onChange={(e) =>
                  setF((x) => ({
                    ...x,
                    customerSignatureRequired: e.target.checked,
                  }))
                }
              />
              Customer signature required
            </label>
            <Button type="submit">Generate report</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-5">
          {rows.map((r) => (
            <Link
              className="flex items-center justify-between border-b py-3"
              href={`/design/change-reports/${r.id}`}
              key={r.id}
            >
              <div>
                <strong>
                  {r.reportNumber} · Rev {r.revision} · {r.title}
                </strong>
                <div className="text-sm text-muted-foreground">
                  {r.change.changeNumber} ·{' '}
                  {new Date(r.generatedAt).toLocaleString()}
                </div>
              </div>
              <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
            </Link>
          ))}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
