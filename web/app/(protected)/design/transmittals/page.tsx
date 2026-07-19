'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { useDesignAccess } from '../../../lib/use-design-access';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { statusVariant } from '../../../lib/status';
type P = { id: string; projectNumber: string; name: string };
type D = {
  id: string;
  documentNumber: string;
  title: string;
  project: P;
  revisions: { id: string; revisionCode: string; status: string }[];
};
type T = {
  id: string;
  transmittalNumber: string;
  purpose: string;
  recipientOrganisation: string;
  recipientName: string;
  status: string;
  issuedAt?: string;
  acknowledgedByName?: string;
  project: P;
  items: {
    id: string;
    documentNumberSnapshot: string;
    titleSnapshot: string;
    revisionCodeSnapshot: string;
  }[];
};
export default function Transmittals() {
  const { isDesignHead } = useDesignAccess(),
    [rows, setRows] = useState<T[]>([]),
    [projects, setProjects] = useState<P[]>([]),
    [docs, setDocs] = useState<D[]>([]),
    [f, setF] = useState({
      projectId: '',
      purpose: 'FOR_APPROVAL',
      recipientOrganisation: '',
      recipientName: '',
      recipientEmail: '',
      message: '',
      revisionId: '',
    });
  const load = useCallback(async () => {
    const [t, p, d] = await Promise.all([
      apiFetch<T[]>('/design/transmittals'),
      apiFetch<P[]>('/design/projects'),
      apiFetch<D[]>('/design/documents'),
    ]);
    setRows(t);
    setProjects(p);
    setDocs(d);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function post(path: string, body?: object) {
    await apiFetch(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
    await load();
  }
  async function create(e: FormEvent) {
    e.preventDefault();
    await post('/design/transmittals', { ...f, revisionIds: [f.revisionId] });
  }
  async function acknowledge(t: T) {
    const acknowledgedByName = prompt('Recipient name acknowledging receipt');
    const acknowledgementNote = prompt('Acknowledgement note') || undefined;
    if (acknowledgedByName)
      await post(`/design/transmittals/${t.id}/acknowledge`, {
        acknowledgedByName,
        acknowledgementNote,
      });
  }
  const available = docs
    .filter((d) => d.project.id === f.projectId)
    .flatMap((d) =>
      d.revisions
        .filter((r) => r.status === 'RELEASED')
        .map((r) => ({
          id: r.id,
          label: `${d.documentNumber} · ${d.title} · Rev ${r.revisionCode}`,
        })),
    );
  return (
    <PageContainer>
      <PageHeader
        title="Document Transmittals"
        description="Controlled issue and receipt acknowledgement for released design documents"
      />
      <Card className="mb-5">
        <CardContent className="p-5">
          <form className="grid gap-3 md:grid-cols-3" onSubmit={create}>
            <Select
              required
              value={f.projectId}
              onChange={(e) =>
                setF((x) => ({
                  ...x,
                  projectId: e.target.value,
                  revisionId: '',
                }))
              }
            >
              <option value="">Project</option>
              {projects.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.projectNumber} · {x.name}
                </option>
              ))}
            </Select>
            <Select
              value={f.purpose}
              onChange={(e) => setF((x) => ({ ...x, purpose: e.target.value }))}
            >
              {[
                'FOR_APPROVAL',
                'FOR_INFORMATION',
                'FOR_MANUFACTURE',
                'AS_BUILT',
                'CUSTOMER_ISSUE',
              ].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </Select>
            <Select
              required
              value={f.revisionId}
              onChange={(e) =>
                setF((x) => ({ ...x, revisionId: e.target.value }))
              }
            >
              <option value="">Released document revision</option>
              {available.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </Select>
            <Input
              required
              placeholder="Recipient organisation"
              value={f.recipientOrganisation}
              onChange={(e) =>
                setF((x) => ({ ...x, recipientOrganisation: e.target.value }))
              }
            />
            <Input
              required
              placeholder="Recipient name"
              value={f.recipientName}
              onChange={(e) =>
                setF((x) => ({ ...x, recipientName: e.target.value }))
              }
            />
            <Input
              type="email"
              placeholder="Recipient email"
              value={f.recipientEmail}
              onChange={(e) =>
                setF((x) => ({ ...x, recipientEmail: e.target.value }))
              }
            />
            <Input
              placeholder="Issue message"
              value={f.message}
              onChange={(e) => setF((x) => ({ ...x, message: e.target.value }))}
            />
            <Button type="submit">Create transmittal</Button>
          </form>
        </CardContent>
      </Card>
      {rows.map((t) => (
        <Card className="mb-4" key={t.id}>
          <CardContent className="p-5">
            <div className="flex justify-between">
              <div>
                <strong>
                  {t.transmittalNumber} · {t.purpose}
                </strong>
                <div className="text-sm text-muted-foreground">
                  {t.project.projectNumber} · To {t.recipientName},{' '}
                  {t.recipientOrganisation}
                </div>
              </div>
              <Badge variant={statusVariant(t.status)}>{t.status}</Badge>
            </div>
            <div className="mt-3 text-sm">
              {t.items.map((x) => (
                <div key={x.id}>
                  {x.documentNumberSnapshot} · {x.titleSnapshot} · Rev{' '}
                  {x.revisionCodeSnapshot}
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              {isDesignHead && t.status === 'DRAFT' && (
                <Button
                  size="sm"
                  onClick={() => post(`/design/transmittals/${t.id}/issue`)}
                >
                  Sign and issue
                </Button>
              )}
              {t.status === 'ISSUED' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => acknowledge(t)}
                >
                  Record receipt
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.print()}
              >
                Print
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </PageContainer>
  );
}
