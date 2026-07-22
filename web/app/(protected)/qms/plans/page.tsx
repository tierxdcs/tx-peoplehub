'use client';
import { FormEvent, useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { useQmsAccess } from '../../../lib/use-qms-access';
import { Button } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
type T = { id: string; name: string; status: string };
type P = {
  id: string;
  planNumber: string;
  name: string;
  status: string;
  stages: { name: string }[];
};
export default function Plans() {
  const { isQmsHead } = useQmsAccess(),
    [templates, setTemplates] = useState<T[]>([]),
    [plans, setPlans] = useState<P[]>([]),
    [name, setName] = useState(''),
    [stage, setStage] = useState('Incoming'),
    [templateId, setTemplate] = useState('');
  const load = () =>
    Promise.all([
      apiFetch<T[]>('/qms/templates'),
      apiFetch<P[]>('/qms/plans'),
    ]).then(([t, p]) => {
      setTemplates(t.filter((x) => x.status === 'APPROVED'));
      setPlans(p);
    });
  useEffect(() => {
    load();
  }, []);
  async function create(e: FormEvent) {
    e.preventDefault();
    await apiFetch('/qms/plans', {
      method: 'POST',
      body: JSON.stringify({
        name,
        stages: [
          {
            name: stage,
            stageCode: stage.toUpperCase().replace(/\W+/g, '_'),
            sequence: 1,
            controlPoint: 'HOLD',
            templateId,
            blocksNextStage: true,
          },
        ],
      }),
    });
    await load();
  }
  async function action(id: string, a: string) {
    await apiFetch(`/qms/plans/${id}/${a}`, { method: 'POST', body: '{}' });
    await load();
  }
  return (
    <PageContainer>
      <PageHeader
        title="Quality Plans / ITP"
        description="Configurable inspection stages, hold points and approved checklists"
      />
      <Card className="mb-6">
        <CardContent className="p-5">
          <form className="grid gap-3 md:grid-cols-3" onSubmit={create}>
            <Input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Plan name"
            />
            <Input
              required
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              placeholder="First stage"
            />
            <Select
              required
              value={templateId}
              onChange={(e) => setTemplate(e.target.value)}
            >
              <option value="">Approved template</option>
              {templates.map((t) => (
                <option value={t.id} key={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            <Button type="submit">Create plan</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-5">
          {plans.map((p) => (
            <div
              className="flex flex-col gap-3 border-b py-4 text-sm sm:flex-row sm:items-center sm:justify-between"
              key={p.id}
            >
              <span>
                <b>{p.planNumber}</b> · {p.name} · {p.status} ·{' '}
                {p.stages.length} stages
              </span>
              <div>
                {p.status === 'DRAFT' && (
                  <Button size="sm" onClick={() => action(p.id, 'submit')}>
                    Submit
                  </Button>
                )}
                {isQmsHead && p.status === 'PENDING_APPROVAL' && (
                  <Button size="sm" onClick={() => action(p.id, 'approve')}>
                    Approve
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
