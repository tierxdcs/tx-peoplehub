'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '../../../../lib/api';
import { useQmsAccess } from '../../../../lib/use-qms-access';
import { signatureStyle } from '../../../../lib/signature';
import type { SignatureFont } from '../../../../lib/types';
import { Button } from '../../../../components/ui/button';
import { Card, CardContent } from '../../../../components/ui/card';
import { Input } from '../../../../components/ui/input';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';

type ResponseRow = {
  questionKey: string;
  section: string;
  promptSnapshot: string;
  answer?: unknown;
  result?: string;
  comments?: string;
};

type Finding = {
  findingType: string;
  clause?: string;
  description: string;
  ncrId?: string;
};

type Source = {
  inspectionNumber?: string;
  auditNumber?: string;
  inspectionType?: string;
  auditType?: string;
  status: string;
  overallResult?: string;
  batchOrSerial?: string;
  remarks?: string;
  scope?: string;
  criteria?: string;
  conclusion?: string;
  responses: ResponseRow[];
  findings?: Finding[];
};

type Payload = {
  sourceType: string;
  sourceNumber: string;
  snapshotAt: string;
  inspection?: Source;
  audit?: Source;
  revisionReason?: string;
};

type Report = {
  id: string;
  reportNumber: string;
  revision: number;
  title: string;
  reportType: string;
  status: string;
  frozenPayload: Payload;
  customerSignatureRequired: boolean;
  generatedAt: string;
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

function answerText(value: unknown) {
  if (value == null) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default function ReportDetail() {
  const { id } = useParams<{ id: string }>();
  const { isQmsHead } = useQmsAccess();
  const [report, setReport] = useState<Report>();
  const [customer, setCustomer] = useState({
    signerName: '',
    designation: '',
    organisation: '',
    signatureText: '',
  });
  const [reason, setReason] = useState('');

  const load = useCallback(
    () => apiFetch<Report>(`/qms/reports/${id}`).then(setReport),
    [id],
  );

  useEffect(() => {
    load();
  }, [load]);

  async function action(path: string, body: object = {}) {
    await apiFetch(`/qms/reports/${id}/${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    await load();
  }

  async function signCustomer(event: FormEvent) {
    event.preventDefault();
    await action('sign-customer', customer);
  }

  async function revise(event: FormEvent) {
    event.preventDefault();
    await action('revise', { reason });
  }

  if (!report) return <PageContainer>Loading…</PageContainer>;

  const source = report.frozenPayload.inspection || report.frozenPayload.audit;

  return (
    <>
      <PageContainer>
        <PageHeader
          title={`${report.reportNumber} · Revision ${report.revision}`}
          description={`${report.title} · ${report.status}`}
        />
        <div className="mb-5 flex flex-wrap gap-3">
          <Button onClick={() => window.print()}>Download PDF</Button>
          {isQmsHead && report.status === 'AWAITING_INTERNAL_SIGNATURE' && (
            <Button onClick={() => action('sign-internal')}>Sign as QMS Head</Button>
          )}
        </div>

        {report.status === 'AWAITING_CUSTOMER_SIGNATURE' && (
          <Card className="mb-5">
            <CardContent className="p-5">
              <form className="grid gap-3 md:grid-cols-2" onSubmit={signCustomer}>
                <Input
                  required
                  placeholder="Customer signer name"
                  value={customer.signerName}
                  onChange={(event) =>
                    setCustomer((value) => ({ ...value, signerName: event.target.value }))
                  }
                />
                <Input
                  placeholder="Designation"
                  value={customer.designation}
                  onChange={(event) =>
                    setCustomer((value) => ({ ...value, designation: event.target.value }))
                  }
                />
                <Input
                  placeholder="Organisation"
                  value={customer.organisation}
                  onChange={(event) =>
                    setCustomer((value) => ({ ...value, organisation: event.target.value }))
                  }
                />
                <Input
                  required
                  placeholder="Typed signature"
                  value={customer.signatureText}
                  onChange={(event) =>
                    setCustomer((value) => ({ ...value, signatureText: event.target.value }))
                  }
                />
                <Button type="submit">Record customer signature</Button>
              </form>
            </CardContent>
          </Card>
        )}

        {report.status !== 'SUPERSEDED' && (
          <Card className="mb-5">
            <CardContent className="p-5">
              <form className="flex gap-3" onSubmit={revise}>
                <Input
                  required
                  placeholder="Reason for new revision"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
                <Button variant="outline" type="submit">
                  Create revision
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-6">
            <ReportBody report={report} source={source} />
          </CardContent>
        </Card>
      </PageContainer>
      <div className="print-document">
        <ReportBody report={report} source={source} />
      </div>
    </>
  );
}

function ReportBody({ report, source }: { report: Report; source?: Source }) {
  const metadata = [
    ['Source', report.frozenPayload.sourceNumber],
    ['Type', report.reportType],
    ['Generated', new Date(report.generatedAt).toLocaleString()],
    ['Snapshot', new Date(report.frozenPayload.snapshotAt).toLocaleString()],
    ['Result / status', source?.overallResult || source?.status],
    ['Batch / serial', source?.batchOrSerial],
    ['Scope', source?.scope],
    ['Criteria', source?.criteria],
    ['Revision reason', report.frozenPayload.revisionReason],
  ].filter((entry) => entry[1]);

  return (
    <div className="fixed-light-surface p-1" style={{ lineHeight: 1.5 }}>
      <header style={{ borderBottom: '3px solid #ea580c', paddingBottom: 12, marginBottom: 18 }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 2 }}>
          PhazeOne · Phaze ERP
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>{report.title}</h1>
        <div>
          {report.reportNumber} · Revision {report.revision} · {report.status}
        </div>
      </header>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 20 }}>
        <tbody>
          {metadata.map(([key, value]) => (
            <tr key={key}>
              <th style={{ textAlign: 'left', border: '1px solid #bbb', padding: 7, width: '28%' }}>
                {key}
              </th>
              <td style={{ border: '1px solid #bbb', padding: 7 }}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Checklist results</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 20 }}>
        <thead>
          <tr>
            {['Section', 'Question', 'Answer', 'Result', 'Comments'].map((heading) => (
              <th
                key={heading}
                style={{ background: '#172554', color: '#fff', padding: 7, textAlign: 'left' }}
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {source?.responses?.map((response) => (
            <tr key={response.questionKey} className="print-avoid-break">
              <td style={{ border: '1px solid #bbb', padding: 7 }}>{response.section}</td>
              <td style={{ border: '1px solid #bbb', padding: 7 }}>{response.promptSnapshot}</td>
              <td style={{ border: '1px solid #bbb', padding: 7 }}>
                {answerText(response.answer)}
              </td>
              <td style={{ border: '1px solid #bbb', padding: 7 }}>{response.result || '—'}</td>
              <td style={{ border: '1px solid #bbb', padding: 7 }}>{response.comments || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {source?.findings && (
        <>
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>Audit findings</h2>
          {source.findings.map((finding, index) => (
            <div
              key={index}
              className="print-avoid-break"
              style={{ border: '1px solid #bbb', padding: 8, margin: '6px 0' }}
            >
              <strong>
                {finding.findingType}
                {finding.clause ? ` · ${finding.clause}` : ''}
              </strong>
              <div>{finding.description}</div>
              {finding.ncrId && <div>Linked NCR recorded</div>}
            </div>
          ))}
        </>
      )}

      <div style={{ marginTop: 18 }}>
        <strong>Conclusion / remarks:</strong> {source?.conclusion || source?.remarks || '—'}
      </div>

      <div
        className="print-avoid-break"
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 30, marginTop: 45 }}
      >
        <div style={{ borderTop: '1px solid #555', paddingTop: 8 }}>
          <strong>Internal approval</strong>
          <div
            style={{
              fontSize: 26,
              ...signatureStyle(report.internalSignatureFontSnapshot),
            }}
          >
            {report.internalSignatureTextSnapshot || 'Pending'}
          </div>
          <div>{report.internalSignerNameSnapshot || ''}</div>
          <div>
            {report.internalSignedAt ? new Date(report.internalSignedAt).toLocaleString() : ''}
          </div>
        </div>

        {report.customerSignatureRequired && (
          <div style={{ borderTop: '1px solid #555', paddingTop: 8 }}>
            <strong>Customer acceptance</strong>
            <div style={{ fontSize: 24, fontStyle: 'italic' }}>
              {report.customerSignatureText || 'Pending'}
            </div>
            <div>
              {report.customerSignerName || ''}
              {report.customerSignerDesignation ? ` · ${report.customerSignerDesignation}` : ''}
            </div>
            <div>{report.customerOrganisation || ''}</div>
            <div>
              {report.customerSignedAt ? new Date(report.customerSignedAt).toLocaleString() : ''}
            </div>
          </div>
        )}
      </div>

      <footer style={{ marginTop: 35, borderTop: '1px solid #aaa', paddingTop: 8, fontSize: 10 }}>
        Controlled document. Verify revision and execution status before use. Generated from an
        immutable QMS snapshot.
      </footer>
    </div>
  );
}
