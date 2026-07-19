'use client';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../../../lib/api';
import { Card, CardContent } from '../../../../components/ui/card';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
type Row = {
  partyType: string;
  partyId: string;
  partyName: string;
  outstanding: string;
  overdue: string;
  invoiceCount: number;
};
type Commitment = {
  id: string;
  poNumber: string;
  partyName: string;
  status: string;
  issuedAt?: string;
  orderedValue: string;
  acceptedValue: string;
  billedValue: string;
  unreceivedCommitment: string;
  unbilledCommitment: string;
};
export default function ApSummaryPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  useEffect(() => {
    Promise.all([
      apiFetch<Row[]>('/finance/ap/summary'),
      apiFetch<Commitment[]>('/finance/ap/po-commitments'),
    ]).then(([summary, pos]) => {
      setRows(summary);
      setCommitments(pos);
    });
  }, []);
  return (
    <PageContainer>
      <PageHeader
        title="Vendor-wise AP Summary"
        description="Approved supplier and vendor liabilities with overdue exposure"
      />
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="p-3">Party</th>
                <th>Type</th>
                <th>Invoices</th>
                <th>Outstanding</th>
                <th>Overdue</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr className="border-b" key={`${r.partyType}:${r.partyId}`}>
                  <td className="p-3 font-medium">{r.partyName}</td>
                  <td>{r.partyType}</td>
                  <td>{r.invoiceCount}</td>
                  <td>₹ {r.outstanding}</td>
                  <td>₹ {r.overdue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Card className="mt-6">
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="p-3">Released PO</th>
                <th>Party</th>
                <th>Ordered</th>
                <th>QC accepted</th>
                <th>Billed</th>
                <th>Unreceived</th>
                <th>Unbilled</th>
              </tr>
            </thead>
            <tbody>
              {commitments.map((p) => (
                <tr className="border-b" key={p.id}>
                  <td className="p-3 font-mono">
                    {p.poNumber}
                    <br />
                    <span className="text-xs">{p.status}</span>
                  </td>
                  <td>{p.partyName}</td>
                  <td>₹ {p.orderedValue}</td>
                  <td>₹ {p.acceptedValue}</td>
                  <td>₹ {p.billedValue}</td>
                  <td>₹ {p.unreceivedCommitment}</td>
                  <td>₹ {p.unbilledCommitment}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
