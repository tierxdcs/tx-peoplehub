'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Select } from '../../../components/ui/select';
import { statusVariant } from '../../../lib/status';

type Project = { id: string; projectNumber: string; name: string };
type Employee = { id: string; firstName: string; lastName: string };
type Change = {
  id: string;
  changeNumber: string;
  title: string;
  type: string;
  priority: string;
  status: string;
  targetDate: string;
  project: Project;
  impacts: { status: string }[];
  affectedItems: unknown[];
  acknowledgements: { status: string }[];
};

const TYPES = [
  'CORRECTION',
  'CUSTOMER_REQUEST',
  'VALUE_ENGINEERING',
  'COST_REDUCTION',
  'OBSOLESCENCE',
  'REGULATORY',
  'PROCESS_IMPROVEMENT',
  'OTHER',
];

export default function EngineeringChanges() {
  const [rows, setRows] = useState<Change[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [people, setPeople] = useState<Employee[]>([]);
  const [form, setForm] = useState({
    projectId: '',
    title: '',
    type: 'CORRECTION',
    priority: 'MEDIUM',
    reason: '',
    proposedChange: '',
    coordinatorId: '',
    targetDate: '',
  });
  const load = useCallback(async () => {
    const [changes, projectRows, employees] = await Promise.all([
      apiFetch<Change[]>('/design/changes'),
      apiFetch<Project[]>('/design/projects'),
      apiFetch<Employee[]>('/design/references/employees'),
    ]);
    setRows(changes);
    setProjects(projectRows);
    setPeople(employees);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function create(e: FormEvent) {
    e.preventDefault();
    await apiFetch('/design/changes', {
      method: 'POST',
      body: JSON.stringify(form),
    });
    setForm((x) => ({ ...x, title: '', reason: '', proposedChange: '' }));
    await load();
  }
  return (
    <PageContainer>
      <PageHeader
        title="Engineering Changes"
        description="Controlled ECR/ECO impact, approval, effectivity and implementation"
      />
      <Card className="mb-5">
        <CardContent className="p-5">
          <form className="grid gap-3 md:grid-cols-3" onSubmit={create}>
            <Select
              required
              value={form.projectId}
              onChange={(e) =>
                setForm((x) => ({ ...x, projectId: e.target.value }))
              }
            >
              <option value="">Design project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.projectNumber} · {p.name}
                </option>
              ))}
            </Select>
            <Input
              required
              placeholder="Change title"
              value={form.title}
              onChange={(e) =>
                setForm((x) => ({ ...x, title: e.target.value }))
              }
            />
            <Select
              value={form.type}
              onChange={(e) => setForm((x) => ({ ...x, type: e.target.value }))}
            >
              {TYPES.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </Select>
            <Select
              value={form.priority}
              onChange={(e) =>
                setForm((x) => ({ ...x, priority: e.target.value }))
              }
            >
              {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </Select>
            <Select
              required
              value={form.coordinatorId}
              onChange={(e) =>
                setForm((x) => ({ ...x, coordinatorId: e.target.value }))
              }
            >
              <option value="">Change coordinator</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.firstName} {p.lastName}
                </option>
              ))}
            </Select>
            <Input
              required
              type="date"
              value={form.targetDate}
              onChange={(e) =>
                setForm((x) => ({ ...x, targetDate: e.target.value }))
              }
            />
            <Input
              required
              placeholder="Reason / problem"
              value={form.reason}
              onChange={(e) =>
                setForm((x) => ({ ...x, reason: e.target.value }))
              }
            />
            <Input
              required
              placeholder="Proposed change"
              value={form.proposedChange}
              onChange={(e) =>
                setForm((x) => ({ ...x, proposedChange: e.target.value }))
              }
            />
            <Button type="submit">Create ECR</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-5">
          {rows.map((x) => (
            <Link
              key={x.id}
              href={`/design/changes/${x.id}`}
              className="flex items-center justify-between border-b py-4 hover:bg-muted/40"
            >
              <div>
                <div className="font-medium">
                  {x.changeNumber} · {x.title}
                </div>
                <div className="text-sm text-muted-foreground">
                  {x.project.projectNumber} · {x.type} ·{' '}
                  {x.affectedItems.length} affected ·{' '}
                  {x.impacts.filter((i) => i.status === 'COMPLETED').length}/
                  {x.impacts.length} assessed
                </div>
              </div>
              <div className="text-right">
                <Badge variant={statusVariant(x.status)}>{x.status}</Badge>
                <div className="mt-1 text-xs text-muted-foreground">
                  Target {new Date(x.targetDate).toLocaleDateString()}
                </div>
              </div>
            </Link>
          ))}
          {!rows.length && (
            <div className="text-sm text-muted-foreground">
              No engineering changes recorded.
            </div>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
