'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { Button } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
type E = { id: string; firstName: string; lastName: string };
type Req = {
  id: string;
  requirementNumber: string;
  category: string;
  description: string;
  acceptanceCriteria: string;
  verificationMethod: string;
  status: string;
};
type Mil = {
  id: string;
  title: string;
  ownerId: string;
  dueDate: string;
  status: string;
};
type P = {
  id: string;
  projectNumber: string;
  name: string;
  requirements: Req[];
  milestones: Mil[];
};
const categories = [
    'CUSTOMER',
    'FUNCTIONAL',
    'PERFORMANCE',
    'INTERFACE',
    'MATERIAL',
    'SAFETY',
    'REGULATORY',
    'MANUFACTURING',
    'INSPECTION',
    'OTHER',
  ],
  methods = [
    'CALCULATION',
    'SIMULATION',
    'DRAWING_REVIEW',
    'INSPECTION',
    'TEST',
    'PROTOTYPE',
    'COMPARISON',
    'CUSTOMER_REVIEW',
  ];
export default function Controls() {
  const [projects, setProjects] = useState<P[]>([]),
    [people, setPeople] = useState<E[]>([]),
    [projectId, setProject] = useState(''),
    [req, setReq] = useState({
      category: 'CUSTOMER',
      description: '',
      source: '',
      acceptanceCriteria: '',
      verificationMethod: 'DRAWING_REVIEW',
    }),
    [mil, setMil] = useState({
      title: '',
      description: '',
      ownerId: '',
      dueDate: '',
    });
  const load = useCallback(() =>
    Promise.all([
      apiFetch<P[]>('/design/projects'),
      apiFetch<E[]>('/design/references/employees'),
    ]).then(([p, e]) => {
      setProjects(p);
      setPeople(e);
      if (p[0]) setProject((current) => current || p[0].id);
    }), []);
  useEffect(() => {
    load();
  }, [load]);
  const project = projects.find((x) => x.id === projectId);
  async function addReq(e: FormEvent) {
    e.preventDefault();
    await apiFetch('/design/requirements', {
      method: 'POST',
      body: JSON.stringify({ ...req, projectId }),
    });
    await load();
  }
  async function verify(id: string, status: string) {
    const result = window.prompt(
      status === 'VERIFIED'
        ? 'Verification result / evidence summary'
        : 'Failure or N/A reason',
    );
    if (!result) return;
    await apiFetch(`/design/requirements/${id}/verify`, {
      method: 'POST',
      body: JSON.stringify({ status, result }),
    });
    await load();
  }
  async function addMil(e: FormEvent) {
    e.preventDefault();
    await apiFetch('/design/milestones', {
      method: 'POST',
      body: JSON.stringify({ ...mil, projectId }),
    });
    await load();
  }
  async function milestone(id: string, status: string) {
    await apiFetch(`/design/milestones/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    await load();
  }
  return (
    <PageContainer>
      <PageHeader
        title="Design Inputs & Deliverables"
        description="Requirement traceability, verification evidence and milestone control"
      />
      <Select
        className="mb-5"
        value={projectId}
        onChange={(e) => setProject(e.target.value)}
      >
        <option value="">Select project</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.projectNumber} · {p.name}
          </option>
        ))}
      </Select>
      {project && (
        <>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardContent className="p-5">
                <h2 className="mb-3 font-semibold">Add design input</h2>
                <form className="grid gap-3" onSubmit={addReq}>
                  <Select
                    value={req.category}
                    onChange={(e) =>
                      setReq((x) => ({ ...x, category: e.target.value }))
                    }
                  >
                    {categories.map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </Select>
                  <Input
                    required
                    placeholder="Requirement"
                    value={req.description}
                    onChange={(e) =>
                      setReq((x) => ({ ...x, description: e.target.value }))
                    }
                  />
                  <Input
                    placeholder="Source / reference"
                    value={req.source}
                    onChange={(e) =>
                      setReq((x) => ({ ...x, source: e.target.value }))
                    }
                  />
                  <Input
                    required
                    placeholder="Acceptance criteria"
                    value={req.acceptanceCriteria}
                    onChange={(e) =>
                      setReq((x) => ({
                        ...x,
                        acceptanceCriteria: e.target.value,
                      }))
                    }
                  />
                  <Select
                    value={req.verificationMethod}
                    onChange={(e) =>
                      setReq((x) => ({
                        ...x,
                        verificationMethod: e.target.value,
                      }))
                    }
                  >
                    {methods.map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </Select>
                  <Button type="submit">Add requirement</Button>
                </form>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <h2 className="mb-3 font-semibold">
                  Add milestone / deliverable
                </h2>
                <form className="grid gap-3" onSubmit={addMil}>
                  <Input
                    required
                    placeholder="Milestone title"
                    value={mil.title}
                    onChange={(e) =>
                      setMil((x) => ({ ...x, title: e.target.value }))
                    }
                  />
                  <Input
                    placeholder="Description"
                    value={mil.description}
                    onChange={(e) =>
                      setMil((x) => ({ ...x, description: e.target.value }))
                    }
                  />
                  <Select
                    required
                    value={mil.ownerId}
                    onChange={(e) =>
                      setMil((x) => ({ ...x, ownerId: e.target.value }))
                    }
                  >
                    <option value="">Owner</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.firstName} {p.lastName}
                      </option>
                    ))}
                  </Select>
                  <Input
                    required
                    type="date"
                    value={mil.dueDate}
                    onChange={(e) =>
                      setMil((x) => ({ ...x, dueDate: e.target.value }))
                    }
                  />
                  <Button type="submit">Add milestone</Button>
                </form>
              </CardContent>
            </Card>
          </div>
          <Card className="mt-5">
            <CardContent className="p-5">
              <h2 className="font-semibold">Requirements</h2>
              {project.requirements.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between border-b py-3 text-sm"
                >
                  <div>
                    <strong>
                      {r.requirementNumber} · {r.category}
                    </strong>
                    <div>{r.description}</div>
                    <div className="text-muted-foreground">
                      {r.verificationMethod} · {r.acceptanceCriteria} ·{' '}
                      {r.status}
                    </div>
                  </div>
                  {r.status === 'OPEN' && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => verify(r.id, 'VERIFIED')}
                      >
                        Verify
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => verify(r.id, 'FAILED')}
                      >
                        Fail
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
          <Card className="mt-5">
            <CardContent className="p-5">
              <h2 className="font-semibold">Milestones</h2>
              {project.milestones.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between border-b py-3 text-sm"
                >
                  <div>
                    <strong>{m.title}</strong>
                    <div className="text-muted-foreground">
                      Due {new Date(m.dueDate).toLocaleDateString()} ·{' '}
                      {m.status}
                    </div>
                  </div>
                  <Select
                    value={m.status}
                    onChange={(e) => milestone(m.id, e.target.value)}
                  >
                    {[
                      'PLANNED',
                      'IN_PROGRESS',
                      'COMPLETED',
                      'DELAYED',
                      'CANCELLED',
                    ].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </Select>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </PageContainer>
  );
}
