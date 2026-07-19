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
type E = { id: string; firstName: string; lastName: string };
type A = {
  id: string;
  actionNumber: number;
  description: string;
  ownerId: string;
  dueDate: string;
  status: string;
};
type R = {
  id: string;
  reviewNumber: string;
  reviewType: string;
  title: string;
  objectives: string;
  scheduledAt: string;
  status: string;
  minutes?: string;
  decision?: string;
  project: P;
  attendees: { id: string; name: string; attended: boolean }[];
  actions: A[];
};
const TYPES = [
  'REQUIREMENTS_REVIEW',
  'CONCEPT_REVIEW',
  'PRELIMINARY_DESIGN_REVIEW',
  'CRITICAL_DESIGN_REVIEW',
  'MANUFACTURING_READINESS_REVIEW',
  'CHANGE_REVIEW',
  'FINAL_DESIGN_REVIEW',
];
export default function Reviews() {
  const { isDesignHead } = useDesignAccess(),
    [rows, setRows] = useState<R[]>([]),
    [projects, setProjects] = useState<P[]>([]),
    [people, setPeople] = useState<E[]>([]),
    [f, setF] = useState({
      projectId: '',
      reviewType: 'REQUIREMENTS_REVIEW',
      title: '',
      objectives: '',
      scheduledAt: '',
      locationOrLink: '',
      chairpersonId: '',
    });
  const load = useCallback(async () => {
    const [r, p, e] = await Promise.all([
      apiFetch<R[]>('/design/reviews'),
      apiFetch<P[]>('/design/projects'),
      apiFetch<E[]>('/design/references/employees'),
    ]);
    setRows(r);
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
    await post('/design/reviews', {
      ...f,
      scheduledAt: new Date(f.scheduledAt).toISOString(),
    });
  }
  async function attendee(r: R) {
    const name = prompt('Attendee name');
    if (!name) return;
    const functionName = prompt('Function / organisation') || undefined;
    await post(`/design/reviews/${r.id}/attendees`, {
      name,
      functionName,
      external: true,
    });
  }
  async function action(r: R) {
    const description = prompt('Action description');
    if (!description) return;
    const ownerId = prompt(
      `Owner ID:\n${people.map((x) => `${x.firstName} ${x.lastName}: ${x.id}`).join('\n')}`,
    );
    const dueDate = prompt('Due date (YYYY-MM-DD)');
    if (ownerId && dueDate)
      await post(`/design/reviews/${r.id}/actions`, {
        description,
        ownerId,
        dueDate,
      });
  }
  async function record(r: R) {
    const minutes = prompt('Meeting minutes');
    const decision = prompt('Review decision / conclusion');
    if (minutes && decision)
      await post(`/design/reviews/${r.id}/record`, {
        minutes,
        decision,
        attendedIds: r.attendees.map((x) => x.id),
      });
  }
  return (
    <PageContainer>
      <PageHeader
        title="Design Reviews"
        description="Formal review meetings, minutes, decisions and verified actions"
      />
      <Card className="mb-5">
        <CardContent className="p-5">
          <form className="grid gap-3 md:grid-cols-3" onSubmit={create}>
            <Select
              required
              value={f.projectId}
              onChange={(e) =>
                setF((x) => ({ ...x, projectId: e.target.value }))
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
              value={f.reviewType}
              onChange={(e) =>
                setF((x) => ({ ...x, reviewType: e.target.value }))
              }
            >
              {TYPES.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </Select>
            <Input
              required
              placeholder="Review title"
              value={f.title}
              onChange={(e) => setF((x) => ({ ...x, title: e.target.value }))}
            />
            <Input
              required
              placeholder="Objectives / agenda"
              value={f.objectives}
              onChange={(e) =>
                setF((x) => ({ ...x, objectives: e.target.value }))
              }
            />
            <Input
              required
              type="datetime-local"
              value={f.scheduledAt}
              onChange={(e) =>
                setF((x) => ({ ...x, scheduledAt: e.target.value }))
              }
            />
            <Select
              required
              value={f.chairpersonId}
              onChange={(e) =>
                setF((x) => ({ ...x, chairpersonId: e.target.value }))
              }
            >
              <option value="">Chairperson</option>
              {people.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.firstName} {x.lastName}
                </option>
              ))}
            </Select>
            <Input
              placeholder="Room / meeting link"
              value={f.locationOrLink}
              onChange={(e) =>
                setF((x) => ({ ...x, locationOrLink: e.target.value }))
              }
            />
            <Button type="submit">Schedule review</Button>
          </form>
        </CardContent>
      </Card>
      {rows.map((r) => (
        <Card className="mb-4" key={r.id}>
          <CardContent className="p-5">
            <div className="flex justify-between">
              <div>
                <strong>
                  {r.reviewNumber} · {r.title}
                </strong>
                <div className="text-sm text-muted-foreground">
                  {r.project.projectNumber} · {r.reviewType} ·{' '}
                  {new Date(r.scheduledAt).toLocaleString()}
                </div>
              </div>
              <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
            </div>
            <p className="mt-2 text-sm">{r.objectives}</p>
            {r.minutes && (
              <div className="mt-2 text-sm">
                <strong>Minutes:</strong> {r.minutes}
                <br />
                <strong>Decision:</strong> {r.decision}
              </div>
            )}
            <div className="mt-3 text-sm">
              Attendees: {r.attendees.map((x) => x.name).join(', ') || 'None'} ·
              Actions: {r.actions.length}
            </div>
            {r.actions.map((a) => (
              <div
                className="mt-2 flex items-center justify-between border-t pt-2 text-sm"
                key={a.id}
              >
                <span>
                  #{a.actionNumber} {a.description} · {a.status}
                </span>
                <div>
                  {a.status === 'OPEN' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const completionNote = prompt('Completion note');
                        if (completionNote)
                          post(`/design/review-actions/${a.id}/complete`, {
                            completionNote,
                          });
                      }}
                    >
                      Complete
                    </Button>
                  )}{' '}
                  {isDesignHead && a.status === 'COMPLETED' && (
                    <Button
                      size="sm"
                      onClick={() =>
                        post(`/design/review-actions/${a.id}/verify`)
                      }
                    >
                      Verify
                    </Button>
                  )}
                </div>
              </div>
            ))}
            <div className="mt-3 flex flex-wrap gap-2">
              {['SCHEDULED', 'IN_PROGRESS'].includes(r.status) && (
                <Button size="sm" variant="outline" onClick={() => attendee(r)}>
                  Add attendee
                </Button>
              )}
              {['SCHEDULED', 'IN_PROGRESS', 'PENDING_CLOSURE'].includes(
                r.status,
              ) && (
                <Button size="sm" variant="outline" onClick={() => action(r)}>
                  Add action
                </Button>
              )}
              {r.status === 'SCHEDULED' && (
                <Button
                  size="sm"
                  onClick={() => post(`/design/reviews/${r.id}/start`)}
                >
                  Start
                </Button>
              )}
              {r.status === 'IN_PROGRESS' && (
                <Button size="sm" onClick={() => record(r)}>
                  Record minutes
                </Button>
              )}
              {isDesignHead && r.status === 'PENDING_CLOSURE' && (
                <Button
                  size="sm"
                  onClick={() => post(`/design/reviews/${r.id}/close`)}
                >
                  Close review
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </PageContainer>
  );
}
