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
type T = {
  id: string;
  templateCode: string;
  name: string;
  description?: string;
  status: string;
  version: number;
  requirements: object[];
  milestones: object[];
};
type P = { id: string; projectNumber: string; name: string };
type E = { id: string; firstName: string; lastName: string };
export default function Templates() {
  const { isDesignHead } = useDesignAccess(),
    [rows, setRows] = useState<T[]>([]),
    [projects, setProjects] = useState<P[]>([]),
    [people, setPeople] = useState<E[]>([]),
    [f, setF] = useState({
      name: '',
      description: '',
      reqDescription: '',
      acceptanceCriteria: '',
      milestoneTitle: '',
      dueOffsetDays: '7',
    });
  const load = useCallback(async () => {
    const [t, p, e] = await Promise.all([
      apiFetch<T[]>('/design/templates'),
      apiFetch<P[]>('/design/projects'),
      apiFetch<E[]>('/design/references/employees'),
    ]);
    setRows(t);
    setProjects(p);
    setPeople(e);
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
    await post('/design/templates', {
      name: f.name,
      description: f.description,
      requirements: [
        {
          category: 'FUNCTIONAL',
          description: f.reqDescription,
          acceptanceCriteria: f.acceptanceCriteria,
          verificationMethod: 'DRAWING_REVIEW',
          required: true,
        },
      ],
      milestones: [
        { title: f.milestoneTitle, dueOffsetDays: Number(f.dueOffsetDays) },
      ],
    });
  }
  async function apply(t: T) {
    const projectId = prompt(
      `Project ID:\n${projects.map((x) => `${x.projectNumber} ${x.name}: ${x.id}`).join('\n')}`,
    );
    const defaultOwnerId = prompt(
      `Default owner ID:\n${people.map((x) => `${x.firstName} ${x.lastName}: ${x.id}`).join('\n')}`,
    );
    const startDate = prompt('Start date (YYYY-MM-DD)');
    if (projectId && defaultOwnerId && startDate)
      await post(`/design/templates/${t.id}/apply`, {
        projectId,
        defaultOwnerId,
        startDate,
      });
  }
  return (
    <PageContainer>
      <PageHeader
        title="Design Project Templates"
        description="Reusable requirement and milestone packs for consistent project setup"
      />
      <Card className="mb-5">
        <CardContent className="p-5">
          <form className="grid gap-3 md:grid-cols-3" onSubmit={create}>
            <Input
              required
              placeholder="Template name"
              value={f.name}
              onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))}
            />
            <Input
              placeholder="Description"
              value={f.description}
              onChange={(e) =>
                setF((x) => ({ ...x, description: e.target.value }))
              }
            />
            <Input
              required
              placeholder="Standard requirement"
              value={f.reqDescription}
              onChange={(e) =>
                setF((x) => ({ ...x, reqDescription: e.target.value }))
              }
            />
            <Input
              required
              placeholder="Acceptance criteria"
              value={f.acceptanceCriteria}
              onChange={(e) =>
                setF((x) => ({ ...x, acceptanceCriteria: e.target.value }))
              }
            />
            <Input
              required
              placeholder="Standard milestone"
              value={f.milestoneTitle}
              onChange={(e) =>
                setF((x) => ({ ...x, milestoneTitle: e.target.value }))
              }
            />
            <Input
              required
              type="number"
              min="0"
              placeholder="Due offset days"
              value={f.dueOffsetDays}
              onChange={(e) =>
                setF((x) => ({ ...x, dueOffsetDays: e.target.value }))
              }
            />
            <Button type="submit">Create template</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-5">
          {rows.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between border-b py-3"
            >
              <div>
                <strong>
                  {t.templateCode} · {t.name}
                </strong>
                <div className="text-sm text-muted-foreground">
                  Version {t.version} · {t.requirements.length} requirements ·{' '}
                  {t.milestones.length} milestones
                </div>
              </div>
              <div className="flex gap-2">
                <Badge variant={statusVariant(t.status)}>{t.status}</Badge>
                {isDesignHead && t.status === 'DRAFT' && (
                  <Button
                    size="sm"
                    onClick={() => post(`/design/templates/${t.id}/approve`)}
                  >
                    Approve
                  </Button>
                )}
                {t.status === 'APPROVED' && (
                  <Button size="sm" variant="outline" onClick={() => apply(t)}>
                    Apply
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
