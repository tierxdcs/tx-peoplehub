'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '../../../../lib/api';
import { useDesignAccess } from '../../../../lib/use-design-access';
import { signatureStyle } from '../../../../lib/signature';
import type { SignatureFont } from '../../../../lib/types';
import { Button } from '../../../../components/ui/button';
import { Card, CardContent } from '../../../../components/ui/card';
import { Input } from '../../../../components/ui/input';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
type Impact = {
  area: string;
  hasImpact?: boolean;
  assessment?: string;
  requiredAction?: string;
  status: string;
};
type Item = {
  objectType: string;
  reference: string;
  currentRevision?: string;
  proposedRevision?: string;
  disposition: string;
  effectivityType: string;
  effectivityValue?: string;
};
type Ack = { functionName: string; status: string; comments?: string };
type Change = {
  changeNumber: string;
  title: string;
  type: string;
  priority: string;
  status: string;
  reason: string;
  proposedChange: string;
  implementationNote?: string;
  project: { projectNumber: string; name: string };
  impacts: Impact[];
  affectedItems: Item[];
  acknowledgements: Ack[];
};
type R = {
  id: string;
  reportNumber: string;
  revision: number;
  title: string;
  status: string;
  generatedAt: string;
  customerSignatureRequired: boolean;
  frozenPayload: {
    snapshotAt: string;
    change: Change;
    revisionReason?: string;
  };
  internalSignerNameSnapshot?: string;
  internalSignatureTextSnapshot?: string;
  internalSignatureFontSnapshot?: SignatureFont;
  internalSignedAt?: string;
  customerSignerName?: string;
  customerSignerDesignation?: string;
  customerOrganisation?: string;
  customerSignatureText?: string;
  customerSignedAt?: string;
};
export default function ChangeReport() {
  const { id } = useParams<{ id: string }>(),
    { isDesignHead } = useDesignAccess(),
    [r, setR] = useState<R>(),
    [customer, setCustomer] = useState({
      signerName: '',
      designation: '',
      organisation: '',
      signatureText: '',
    }),
    [reason, setReason] = useState('');
  const load = useCallback(
    () => apiFetch<R>(`/design/change-reports/${id}`).then(setR),
    [id],
  );
  useEffect(() => {
    void load();
  }, [load]);
  async function post(path: string, body: object = {}) {
    await apiFetch(`/design/change-reports/${id}/${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    await load();
  }
  async function signCustomer(e: FormEvent) {
    e.preventDefault();
    await post('sign-customer', customer);
  }
  async function revise(e: FormEvent) {
    e.preventDefault();
    await post('revise', { reason });
  }
  if (!r) return null;
  return (
    <>
      <PageContainer>
        <PageHeader
          title={`${r.reportNumber} · Revision ${r.revision}`}
          description={`${r.title} · ${r.status}`}
        />
        <div className="mb-5 flex gap-2">
          <Button onClick={() => window.print()}>Download PDF</Button>
          {isDesignHead && r.status === 'AWAITING_INTERNAL_SIGNATURE' && (
            <Button onClick={() => post('sign-internal')}>
              Sign as Design Head
            </Button>
          )}
        </div>
        {r.status === 'AWAITING_CUSTOMER_SIGNATURE' && (
          <Card className="mb-5">
            <CardContent className="p-5">
              <form
                className="grid gap-3 md:grid-cols-2"
                onSubmit={signCustomer}
              >
                <Input
                  required
                  placeholder="Customer signer name"
                  value={customer.signerName}
                  onChange={(e) =>
                    setCustomer((x) => ({ ...x, signerName: e.target.value }))
                  }
                />
                <Input
                  placeholder="Designation"
                  value={customer.designation}
                  onChange={(e) =>
                    setCustomer((x) => ({ ...x, designation: e.target.value }))
                  }
                />
                <Input
                  placeholder="Organisation"
                  value={customer.organisation}
                  onChange={(e) =>
                    setCustomer((x) => ({ ...x, organisation: e.target.value }))
                  }
                />
                <Input
                  required
                  placeholder="Typed signature"
                  value={customer.signatureText}
                  onChange={(e) =>
                    setCustomer((x) => ({
                      ...x,
                      signatureText: e.target.value,
                    }))
                  }
                />
                <Button type="submit">Record customer signature</Button>
              </form>
            </CardContent>
          </Card>
        )}
        {r.status !== 'SUPERSEDED' && (
          <Card className="mb-5">
            <CardContent className="p-5">
              <form className="flex gap-3" onSubmit={revise}>
                <Input
                  required
                  placeholder="Revision reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <Button variant="outline" type="submit">
                  Create report revision
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="p-6">
            <ReportBody r={r} />
          </CardContent>
        </Card>
      </PageContainer>
      <div className="print-document">
        <ReportBody r={r} />
      </div>
    </>
  );
}
function ReportBody({ r }: { r: R }) {
  const c = r.frozenPayload.change;
  return (
    <div style={{ color: '#111', lineHeight: 1.5 }}>
      <header
        style={{
          borderBottom: '3px solid #ea580c',
          paddingBottom: 12,
          marginBottom: 18,
        }}
      >
        <div
          style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 2 }}
        >
          Workcore · Phaze ERP
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>
          Engineering Change Report
        </h1>
        <div>
          {r.reportNumber} · Revision {r.revision} · {r.status}
        </div>
      </header>
      <table
        style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 20 }}
      >
        <tbody>
          {[
            ['Change', c.changeNumber],
            ['Title', c.title],
            ['Project', `${c.project.projectNumber} · ${c.project.name}`],
            ['Type / priority', `${c.type} · ${c.priority}`],
            ['Change status', c.status],
            ['Generated', new Date(r.generatedAt).toLocaleString()],
            ['Revision reason', r.frozenPayload.revisionReason],
          ]
            .filter((x) => x[1])
            .map(([k, v]) => (
              <tr key={k}>
                <th
                  style={{
                    textAlign: 'left',
                    border: '1px solid #bbb',
                    padding: 7,
                    width: '28%',
                  }}
                >
                  {k}
                </th>
                <td style={{ border: '1px solid #bbb', padding: 7 }}>{v}</td>
              </tr>
            ))}
        </tbody>
      </table>
      <h2 style={{ fontSize: 16, fontWeight: 700 }}>Reason</h2>
      <p>{c.reason}</p>
      <h2 style={{ fontSize: 16, fontWeight: 700 }}>Approved change</h2>
      <p>{c.proposedChange}</p>
      <h2 style={{ fontSize: 16, fontWeight: 700 }}>
        Affected records and effectivity
      </h2>
      {c.affectedItems.map((x, i) => (
        <div
          key={i}
          className="print-avoid-break"
          style={{ border: '1px solid #bbb', padding: 8, margin: '6px 0' }}
        >
          <strong>
            {x.objectType} · {x.reference}
          </strong>
          <div>
            {x.currentRevision || '—'} → {x.proposedRevision || '—'} ·{' '}
            {x.disposition} · {x.effectivityType} {x.effectivityValue || ''}
          </div>
        </div>
      ))}
      <h2 style={{ fontSize: 16, fontWeight: 700 }}>Impact assessment</h2>
      {c.impacts.map((x, i) => (
        <div
          key={i}
          className="print-avoid-break"
          style={{ borderBottom: '1px solid #ccc', padding: 7 }}
        >
          <strong>
            {x.area}: {x.hasImpact ? 'IMPACT' : 'NO IMPACT'}
          </strong>
          <div>{x.assessment || '—'}</div>
          {x.requiredAction && <div>Action: {x.requiredAction}</div>}
        </div>
      ))}
      <h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 16 }}>
        Implementation
      </h2>
      <p>{c.implementationNote || 'Pending implementation completion'}</p>
      <div
        className="print-avoid-break"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 30,
          marginTop: 45,
        }}
      >
        <div style={{ borderTop: '1px solid #555', paddingTop: 8 }}>
          <strong>Design Head approval</strong>
          <div
            style={{
              fontSize: 26,
              ...signatureStyle(r.internalSignatureFontSnapshot),
            }}
          >
            {r.internalSignatureTextSnapshot || 'Pending'}
          </div>
          <div>{r.internalSignerNameSnapshot || ''}</div>
          <div>
            {r.internalSignedAt
              ? new Date(r.internalSignedAt).toLocaleString()
              : ''}
          </div>
        </div>
        {r.customerSignatureRequired && (
          <div style={{ borderTop: '1px solid #555', paddingTop: 8 }}>
            <strong>Customer acceptance</strong>
            <div style={{ fontSize: 24, fontStyle: 'italic' }}>
              {r.customerSignatureText || 'Pending'}
            </div>
            <div>
              {r.customerSignerName || ''} {r.customerSignerDesignation || ''}
            </div>
            <div>{r.customerOrganisation || ''}</div>
            <div>
              {r.customerSignedAt
                ? new Date(r.customerSignedAt).toLocaleString()
                : ''}
            </div>
          </div>
        )}
      </div>
      <footer
        style={{
          marginTop: 35,
          borderTop: '1px solid #aaa',
          paddingTop: 8,
          fontSize: 10,
        }}
      >
        Controlled engineering document. Verify report revision and execution
        status before use.
      </footer>
    </div>
  );
}
