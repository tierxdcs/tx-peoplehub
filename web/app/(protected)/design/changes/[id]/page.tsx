'use client';

import { useParams } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../../lib/api';
import { useDesignAccess } from '../../../../lib/use-design-access';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { Card, CardContent } from '../../../../components/ui/card';
import { Input } from '../../../../components/ui/input';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Select } from '../../../../components/ui/select';
import { statusVariant } from '../../../../lib/status';

type Employee = { id: string; firstName: string; lastName: string };
type Impact = {
  id: string;
  area: string;
  ownerId: string;
  status: string;
  hasImpact?: boolean;
  assessment?: string;
  requiredAction?: string;
};
type Item = {
  id: string;
  objectType: string;
  reference: string;
  description?: string;
  currentRevision?: string;
  proposedRevision?: string;
  disposition: string;
  effectivityType: string;
  effectivityValue?: string;
};
type Ack = {
  id: string;
  functionName: string;
  ownerId: string;
  status: string;
  comments?: string;
};
type Change = {
  id: string;
  changeNumber: string;
  title: string;
  type: string;
  priority: string;
  status: string;
  reason: string;
  proposedChange: string;
  targetDate: string;
  project: { projectNumber: string; name: string };
  rejectionReason?: string;
  implementationNote?: string;
  impacts: Impact[];
  affectedItems: Item[];
  acknowledgements: Ack[];
};

const OBJECT_TYPES = [
  'DOCUMENT_REVISION',
  'BOM',
  'ITEM',
  'INVENTORY',
  'WORK_IN_PROGRESS',
  'PURCHASE_ORDER',
  'SALES_ORDER',
  'OTHER',
];
const DISPOSITIONS = [
  'USE_AS_IS',
  'REWORK',
  'SCRAP',
  'RETURN_TO_VENDOR',
  'HOLD',
  'NOT_APPLICABLE',
];
const EFFECTIVITY = [
  'IMMEDIATE',
  'NEXT_PRODUCTION_RUN',
  'DATE',
  'SERIAL_NUMBER',
  'LOT_NUMBER',
];

export default function EngineeringChangeDetail() {
  const { id } = useParams<{ id: string }>();
  const { isDesignHead } = useDesignAccess();
  const [change, setChange] = useState<Change>();
  const [people, setPeople] = useState<Employee[]>([]);
  const [item, setItem] = useState({
    objectType: 'DOCUMENT_REVISION',
    reference: '',
    description: '',
    currentRevision: '',
    proposedRevision: '',
    effectivityType: 'NEXT_PRODUCTION_RUN',
    effectivityValue: '',
  });
  const [ack, setAck] = useState({ functionName: 'PRODUCTION', ownerId: '' });
  const load = useCallback(async () => {
    const [row, employees] = await Promise.all([
      apiFetch<Change>(`/design/changes/${id}`),
      apiFetch<Employee[]>('/design/references/employees'),
    ]);
    setChange(row);
    setPeople(employees);
  }, [id]);
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
  async function patch(path: string, body: object) {
    await apiFetch(path, { method: 'PATCH', body: JSON.stringify(body) });
    await load();
  }
  async function addItem(e: FormEvent) {
    e.preventDefault();
    await post(`/design/changes/${id}/affected-items`, item);
    setItem((x) => ({
      ...x,
      reference: '',
      description: '',
      currentRevision: '',
      proposedRevision: '',
      effectivityValue: '',
    }));
  }
  async function addAck(e: FormEvent) {
    e.preventDefault();
    await post(`/design/changes/${id}/acknowledgements`, ack);
  }
  async function assess(impact: Impact) {
    const assessment = window.prompt(`Assessment for ${impact.area}`);
    if (!assessment) return;
    const hasImpact = window.confirm('Does this area have an impact?');
    const requiredAction = hasImpact
      ? window.prompt('Required action') || ''
      : undefined;
    if (hasImpact && !requiredAction) return;
    await post(`/design/change-impacts/${impact.id}/complete`, {
      hasImpact,
      assessment,
      requiredAction,
    });
  }
  async function disposition(row: Item, value: string) {
    const dispositionNote =
      value === 'NOT_APPLICABLE'
        ? undefined
        : window.prompt('Disposition note') || undefined;
    await patch(`/design/change-affected-items/${row.id}/disposition`, {
      disposition: value,
      dispositionNote,
    });
  }
  async function reject() {
    const reason = window.prompt('Rejection reason');
    if (reason) await post(`/design/changes/${id}/reject`, { reason });
  }
  async function close() {
    const implementationNote = window.prompt(
      'Implementation completion summary',
    );
    if (implementationNote)
      await post(`/design/changes/${id}/close`, { implementationNote });
  }
  if (!change) return null;
  const editable = ['DRAFT', 'IMPACT_ASSESSMENT'].includes(change.status);
  return (
    <PageContainer>
      <PageHeader
        title={`${change.changeNumber} · ${change.title}`}
        description={`${change.project.projectNumber} · ${change.type} · target ${new Date(change.targetDate).toLocaleDateString()}`}
      />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Badge variant={statusVariant(change.status)}>{change.status}</Badge>
        {change.status === 'DRAFT' && (
          <Button onClick={() => post(`/design/changes/${id}/submit`)}>
            Start impact assessment
          </Button>
        )}
        {change.status === 'IMPACT_ASSESSMENT' && (
          <Button onClick={() => post(`/design/changes/${id}/submit-approval`)}>
            Submit for Design Head approval
          </Button>
        )}
        {isDesignHead && change.status === 'PENDING_APPROVAL' && (
          <>
            <Button onClick={() => post(`/design/changes/${id}/approve`)}>
              Approve ECR
            </Button>
            <Button variant="destructive" onClick={reject}>
              Reject
            </Button>
          </>
        )}
        {change.status === 'APPROVED' && (
          <Button
            onClick={() => post(`/design/changes/${id}/start-implementation`)}
          >
            Start implementation
          </Button>
        )}
        {isDesignHead && change.status === 'IMPLEMENTING' && (
          <Button onClick={close}>Close change</Button>
        )}
      </div>
      <Card className="mb-5">
        <CardContent className="grid gap-4 p-5 md:grid-cols-2">
          <div>
            <div className="text-sm font-medium">Reason</div>
            <p>{change.reason}</p>
          </div>
          <div>
            <div className="text-sm font-medium">Proposed change</div>
            <p>{change.proposedChange}</p>
          </div>
          {change.rejectionReason && (
            <p className="text-destructive">
              Rejected: {change.rejectionReason}
            </p>
          )}
          {change.implementationNote && (
            <p>Implemented: {change.implementationNote}</p>
          )}
        </CardContent>
      </Card>
      {editable && (
        <Card className="mb-5">
          <CardContent className="p-5">
            <h2 className="mb-3 font-semibold">
              Affected record and effectivity
            </h2>
            <form className="grid gap-3 md:grid-cols-4" onSubmit={addItem}>
              <Select
                value={item.objectType}
                onChange={(e) =>
                  setItem((x) => ({ ...x, objectType: e.target.value }))
                }
              >
                {OBJECT_TYPES.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </Select>
              <Input
                required
                placeholder="Document/BOM/item reference"
                value={item.reference}
                onChange={(e) =>
                  setItem((x) => ({ ...x, reference: e.target.value }))
                }
              />
              <Input
                placeholder="Description"
                value={item.description}
                onChange={(e) =>
                  setItem((x) => ({ ...x, description: e.target.value }))
                }
              />
              <Input
                placeholder="Current revision"
                value={item.currentRevision}
                onChange={(e) =>
                  setItem((x) => ({ ...x, currentRevision: e.target.value }))
                }
              />
              <Input
                placeholder="Proposed revision"
                value={item.proposedRevision}
                onChange={(e) =>
                  setItem((x) => ({ ...x, proposedRevision: e.target.value }))
                }
              />
              <Select
                value={item.effectivityType}
                onChange={(e) =>
                  setItem((x) => ({ ...x, effectivityType: e.target.value }))
                }
              >
                {EFFECTIVITY.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </Select>
              <Input
                placeholder="Date / serial / lot"
                value={item.effectivityValue}
                onChange={(e) =>
                  setItem((x) => ({ ...x, effectivityValue: e.target.value }))
                }
              />
              <Button type="submit">Add affected record</Button>
            </form>
          </CardContent>
        </Card>
      )}
      <Card className="mb-5">
        <CardContent className="p-5">
          <h2 className="font-semibold">Affected records</h2>
          {change.affectedItems.map((x) => (
            <div
              key={x.id}
              className="grid items-center gap-3 border-b py-3 text-sm md:grid-cols-4"
            >
              <div>
                <strong>
                  {x.objectType} · {x.reference}
                </strong>
                <div>{x.description}</div>
              </div>
              <div>
                {x.currentRevision || '—'} → {x.proposedRevision || '—'}
              </div>
              <div>
                {x.effectivityType}
                {x.effectivityValue ? ` · ${x.effectivityValue}` : ''}
              </div>
              {editable ? (
                <Select
                  value={x.disposition}
                  onChange={(e) => disposition(x, e.target.value)}
                >
                  <option value="PENDING">PENDING</option>
                  {DISPOSITIONS.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </Select>
              ) : (
                <Badge variant={statusVariant(x.disposition)}>
                  {x.disposition}
                </Badge>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
      <Card className="mb-5">
        <CardContent className="p-5">
          <h2 className="font-semibold">Cross-functional impact assessment</h2>
          {change.impacts.map((x) => (
            <div
              key={x.id}
              className="grid items-center gap-3 border-b py-3 text-sm md:grid-cols-4"
            >
              <strong>{x.area}</strong>
              <Select
                disabled={!editable}
                value={x.ownerId}
                onChange={(e) =>
                  patch(`/design/change-impacts/${x.id}/owner`, {
                    ownerId: e.target.value,
                  })
                }
              >
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.firstName} {p.lastName}
                  </option>
                ))}
              </Select>
              <div>
                {x.assessment || 'Pending assessment'}
                {x.requiredAction && (
                  <div className="text-muted-foreground">
                    Action: {x.requiredAction}
                  </div>
                )}
              </div>
              {x.status === 'PENDING' &&
              change.status === 'IMPACT_ASSESSMENT' ? (
                <Button size="sm" onClick={() => assess(x)}>
                  Complete assessment
                </Button>
              ) : (
                <Badge variant={statusVariant(x.status)}>{x.status}</Badge>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-5">
          <h2 className="mb-3 font-semibold">
            Downstream implementation acknowledgement
          </h2>
          {editable && (
            <form className="mb-4 flex gap-3" onSubmit={addAck}>
              <Input
                required
                placeholder="Function (Production, Quality, Stores...)"
                value={ack.functionName}
                onChange={(e) =>
                  setAck((x) => ({ ...x, functionName: e.target.value }))
                }
              />
              <Select
                required
                value={ack.ownerId}
                onChange={(e) =>
                  setAck((x) => ({ ...x, ownerId: e.target.value }))
                }
              >
                <option value="">Acknowledgement owner</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.firstName} {p.lastName}
                  </option>
                ))}
              </Select>
              <Button type="submit">Add owner</Button>
            </form>
          )}
          {change.acknowledgements.map((x) => (
            <div
              key={x.id}
              className="flex items-center justify-between border-b py-3 text-sm"
            >
              <div>
                <strong>{x.functionName}</strong>
                <div className="text-muted-foreground">
                  {people.find((p) => p.id === x.ownerId)?.firstName ||
                    x.ownerId}
                  {x.comments ? ` · ${x.comments}` : ''}
                </div>
              </div>
              {x.status === 'PENDING' && change.status === 'IMPLEMENTING' ? (
                <Button
                  size="sm"
                  onClick={() =>
                    post(
                      `/design/change-acknowledgements/${x.id}/acknowledge`,
                      {
                        comments:
                          window.prompt('Acknowledgement comment') || undefined,
                      },
                    )
                  }
                >
                  Acknowledge
                </Button>
              ) : (
                <Badge variant={statusVariant(x.status)}>{x.status}</Badge>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
