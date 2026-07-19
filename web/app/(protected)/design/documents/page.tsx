'use client';
import { FormEvent, useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { useDesignAccess } from '../../../lib/use-design-access';
import { Button } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
type V = { id: string; versionNumber: number; changeNote?: string };
type F = { id: string; name: string; currentVersionId: string; versions: V[] };
type P = { id: string; projectNumber: string; name: string };
type Rev = {
  id: string;
  revisionNumber: number;
  revisionCode: string;
  status: string;
  changeSummary: string;
  vaultFileVersion: { versionNumber: number };
  rejectionReason?: string;
  customerApprovalRequired: boolean;
  customerApproval?: { status: string; customerApproverName: string };
};
type Doc = {
  id: string;
  documentNumber: string;
  title: string;
  documentType: string;
  project: P;
  vaultFile: { id: string; name: string };
  revisions: Rev[];
};
const types = [
  'GENERAL_ARRANGEMENT',
  'MANUFACTURING_DRAWING',
  'ASSEMBLY_DRAWING',
  'ELECTRICAL_DRAWING',
  'SCHEMATIC',
  'CALCULATION',
  'DATASHEET',
  'SPECIFICATION',
  'THREE_D_MODEL',
  'WORK_INSTRUCTION',
  'OTHER',
];
export default function Documents() {
  const { isDesignHead } = useDesignAccess(),
    [rows, setRows] = useState<Doc[]>([]),
    [projects, setProjects] = useState<P[]>([]),
    [files, setFiles] = useState<F[]>([]),
    [f, setF] = useState({
      projectId: '',
      title: '',
      documentType: 'GENERAL_ARRANGEMENT',
      vaultFileId: '',
      vaultFileVersionId: '',
      revisionCode: 'A',
      changeSummary: '',
      customerApprovalRequired: false,
    }),
    [rev, setRev] = useState<
      Record<
        string,
        {
          vaultFileVersionId: string;
          revisionCode: string;
          changeSummary: string;
          customerApprovalRequired: boolean;
        }
      >
    >({});
  const load = () =>
    Promise.all([
      apiFetch<Doc[]>('/design/documents'),
      apiFetch<P[]>('/design/projects'),
      apiFetch<F[]>('/design/references/vault-files'),
    ]).then(([d, p, v]) => {
      setRows(d);
      setProjects(p);
      setFiles(v);
    });
  useEffect(() => {
    load();
  }, []);
  const selected = files.find((x) => x.id === f.vaultFileId);
  async function create(e: FormEvent) {
    e.preventDefault();
    await apiFetch('/design/documents', {
      method: 'POST',
      body: JSON.stringify(f),
    });
    await load();
  }
  async function act(id: string, a: string, body: object = {}) {
    await apiFetch(`/design/revisions/${id}/${a}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    await load();
  }
  function setRevision(id: string, k: string, v: string | boolean) {
    setRev((x) => {
      const current = x[id] ?? {
        vaultFileVersionId: '',
        revisionCode: '',
        changeSummary: '',
        customerApprovalRequired: false,
      };
      return { ...x, [id]: { ...current, [k]: v } };
    });
  }
  async function newRevision(d: Doc) {
    const x = rev[d.id];
    await apiFetch(`/design/documents/${d.id}/revisions`, {
      method: 'POST',
      body: JSON.stringify(x),
    });
    await load();
  }
  return (
    <PageContainer>
      <PageHeader
        title="Design Document Register"
        description="Formal revisions pinned to immutable Vault file versions"
      />
      <Card className="mb-5">
        <CardContent className="p-5">
          <div className="mb-3 text-sm text-muted-foreground">
            Upload and version the actual file in Vault first, then register the
            exact version here.
          </div>
          <form className="grid gap-3 md:grid-cols-3" onSubmit={create}>
            <Select
              required
              value={f.projectId}
              onChange={(e) =>
                setF((x) => ({ ...x, projectId: e.target.value }))
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
              placeholder="Document title"
              value={f.title}
              onChange={(e) => setF((x) => ({ ...x, title: e.target.value }))}
            />
            <Select
              value={f.documentType}
              onChange={(e) =>
                setF((x) => ({ ...x, documentType: e.target.value }))
              }
            >
              {types.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </Select>
            <Select
              required
              value={f.vaultFileId}
              onChange={(e) => {
                const file = files.find((x) => x.id === e.target.value);
                setF((x) => ({
                  ...x,
                  vaultFileId: e.target.value,
                  vaultFileVersionId: file?.currentVersionId || '',
                }));
              }}
            >
              <option value="">Writable Vault file</option>
              {files.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
            <Select
              required
              value={f.vaultFileVersionId}
              onChange={(e) =>
                setF((x) => ({ ...x, vaultFileVersionId: e.target.value }))
              }
            >
              <option value="">Vault version</option>
              {selected?.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  Version {v.versionNumber}
                  {v.changeNote ? ` · ${v.changeNote}` : ''}
                </option>
              ))}
            </Select>
            <Input
              required
              placeholder="Revision code"
              value={f.revisionCode}
              onChange={(e) =>
                setF((x) => ({ ...x, revisionCode: e.target.value }))
              }
            />
            <Input
              required
              placeholder="Change summary"
              value={f.changeSummary}
              onChange={(e) =>
                setF((x) => ({ ...x, changeSummary: e.target.value }))
              }
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={f.customerApprovalRequired}
                onChange={(e) =>
                  setF((x) => ({
                    ...x,
                    customerApprovalRequired: e.target.checked,
                  }))
                }
              />
              Customer approval required
            </label>
            <Button type="submit">Register document</Button>
          </form>
        </CardContent>
      </Card>
      {rows.map((d) => {
        const file = files.find((x) => x.id === d.vaultFile.id);
        const latest = d.revisions[0];
        return (
          <Card className="mb-4" key={d.id}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold">
                    {d.documentNumber} · {d.title}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {d.project.projectNumber} · {d.documentType} · Vault:{' '}
                    {d.vaultFile.name}
                  </div>
                </div>
              </div>
              {d.revisions.map((r) => (
                <div
                  className="mt-3 flex items-center justify-between rounded border p-3 text-sm"
                  key={r.id}
                >
                  <div>
                    <strong>Rev {r.revisionCode}</strong> · Vault v
                    {r.vaultFileVersion.versionNumber} · {r.status}
                    <div className="text-muted-foreground">
                      {r.changeSummary}
                      {r.rejectionReason
                        ? ` · Rejected: ${r.rejectionReason}`
                        : ''}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {['DRAFT', 'REJECTED'].includes(r.status) && (
                      <Button size="sm" onClick={() => act(r.id, 'submit')}>
                        Submit
                      </Button>
                    )}
                    {r.status === 'PENDING_CHECK' && (
                      <Button
                        size="sm"
                        onClick={() => {
                          const checkNote = window.prompt(
                            'Independent check note',
                          );
                          if (checkNote) act(r.id, 'check', { checkNote });
                        }}
                      >
                        Complete check
                      </Button>
                    )}
                    {r.customerApprovalRequired &&
                      r.status === 'PENDING_APPROVAL' &&
                      r.customerApproval?.status !== 'APPROVED' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const customerApproverName = window.prompt(
                              'Customer approver name',
                            );
                            if (!customerApproverName) return;
                            const approvalReference = window.prompt(
                              'Approval reference / email reference',
                            );
                            act(r.id, 'customer-approval', {
                              status: 'APPROVED',
                              customerApproverName,
                              approvalReference: approvalReference || undefined,
                            });
                          }}
                        >
                          Record customer approval
                        </Button>
                      )}
                    {isDesignHead && r.status === 'PENDING_APPROVAL' && (
                      <>
                        <Button size="sm" onClick={() => act(r.id, 'release')}>
                          Release
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const reason = window.prompt('Rejection reason');
                            if (reason) act(r.id, 'reject', { reason });
                          }}
                        >
                          Reject
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {latest &&
                ['RELEASED', 'REJECTED', 'OBSOLETE'].includes(latest.status) &&
                file && (
                  <div className="mt-4 grid gap-2 md:grid-cols-5">
                    <Select
                      value={rev[d.id]?.vaultFileVersionId || ''}
                      onChange={(e) =>
                        setRevision(d.id, 'vaultFileVersionId', e.target.value)
                      }
                    >
                      <option value="">New Vault version</option>
                      {file.versions.map((v) => (
                        <option key={v.id} value={v.id}>
                          Version {v.versionNumber}
                        </option>
                      ))}
                    </Select>
                    <Input
                      placeholder="New revision code"
                      value={rev[d.id]?.revisionCode || ''}
                      onChange={(e) =>
                        setRevision(d.id, 'revisionCode', e.target.value)
                      }
                    />
                    <Input
                      placeholder="Change summary"
                      value={rev[d.id]?.changeSummary || ''}
                      onChange={(e) =>
                        setRevision(d.id, 'changeSummary', e.target.value)
                      }
                    />
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={
                          rev[d.id]?.customerApprovalRequired || false
                        }
                        onChange={(e) =>
                          setRevision(
                            d.id,
                            'customerApprovalRequired',
                            e.target.checked,
                          )
                        }
                      />
                      Customer approval
                    </label>
                    <Button variant="outline" onClick={() => newRevision(d)}>
                      Create revision
                    </Button>
                  </div>
                )}
            </CardContent>
          </Card>
        );
      })}
    </PageContainer>
  );
}
