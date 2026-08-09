'use client';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../../components/ui/table';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../../../lib/api';
import { Card, CardContent } from '../../../../components/ui/card';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { formatINR } from '../../../../lib/sales';
import { useNumberFormat } from '../../../../lib/number-format-context';
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
  const { style: numberFormatStyle } = useNumberFormat();
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
          <Table className="w-full text-sm">
            <TableHeader>
              <TableRow className="border-b text-left">
                <TableHead className="p-3">Party</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Invoices</TableHead>
                <TableHead>Outstanding</TableHead>
                <TableHead>Overdue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow className="border-b" key={`${r.partyType}:${r.partyId}`}>
                  <TableCell className="p-3 font-medium">{r.partyName}</TableCell>
                  <TableCell>{r.partyType}</TableCell>
                  <TableCell>{r.invoiceCount}</TableCell>
                  <TableCell>{formatINR(r.outstanding, numberFormatStyle)}</TableCell>
                  <TableCell>{formatINR(r.overdue, numberFormatStyle)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card className="mt-6">
        <CardContent className="p-0 overflow-x-auto">
          <Table className="w-full text-sm">
            <TableHeader>
              <TableRow className="border-b text-left">
                <TableHead className="p-3">Released PO</TableHead>
                <TableHead>Party</TableHead>
                <TableHead>Ordered</TableHead>
                <TableHead>QC accepted</TableHead>
                <TableHead>Billed</TableHead>
                <TableHead>Unreceived</TableHead>
                <TableHead>Unbilled</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {commitments.map((p) => (
                <TableRow className="border-b" key={p.id}>
                  <TableCell className="p-3 font-mono">
                    {p.poNumber}
                    <br />
                    <span className="text-xs">{p.status}</span>
                  </TableCell>
                  <TableCell>{p.partyName}</TableCell>
                  <TableCell>{formatINR(p.orderedValue, numberFormatStyle)}</TableCell>
                  <TableCell>{formatINR(p.acceptedValue, numberFormatStyle)}</TableCell>
                  <TableCell>{formatINR(p.billedValue, numberFormatStyle)}</TableCell>
                  <TableCell>{formatINR(p.unreceivedCommitment, numberFormatStyle)}</TableCell>
                  <TableCell>{formatINR(p.unbilledCommitment, numberFormatStyle)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
