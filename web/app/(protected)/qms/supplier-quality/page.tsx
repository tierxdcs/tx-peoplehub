'use client';

import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { apiFetch } from '../../../lib/api';
import { useRegisterList } from '../../../lib/use-register-list';
import { Card, CardContent } from '../../../components/ui/card';
import { EmptyState } from '../../../components/ui/empty-state';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { RegisterPagination } from '../../../components/ui/register-pagination';
import { RegisterToolbar } from '../../../components/ui/register-toolbar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';

type Score = {
  supplierId: string;
  supplierName: string;
  qualificationStatus: string;
  acceptanceRate: number;
  rejectionPpm: number;
  closedQmsAudits: number;
  majorFindings: number;
  minorFindings: number;
  qualityScore: number;
  rating: string;
};

export default function SupplierQuality() {
  const [rows, setRows] = useState<Score[]>([]);
  const register = useRegisterList(
    rows,
    (row) =>
      `${row.supplierName} ${row.qualificationStatus} ${row.rating} ${row.qualityScore}`,
  );

  useEffect(() => {
    void apiFetch<Score[]>('/qms/supplier-scorecards').then(setRows);
  }, []);

  return (
    <PageContainer>
      <PageHeader
        title="Supplier Quality Scorecards"
        description="Live incoming acceptance, rejection PPM and audit-finding performance"
      />
      <RegisterToolbar
        title="Supplier Scorecards"
        search={register.search}
        onSearchChange={register.setSearch}
        searchPlaceholder="Search supplier, status or rating"
      />
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                {[
                  'Supplier',
                  'Qualification',
                  'Acceptance',
                  'Rejection PPM',
                  'QMS audits',
                  'Major / Minor',
                  'Score',
                  'Rating',
                ].map((heading) => (
                  <TableHead key={heading}>{heading}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {register.visibleItems.map((row) => (
                <TableRow key={row.supplierId}>
                  <TableCell className="font-medium">{row.supplierName}</TableCell>
                  <TableCell>{row.qualificationStatus}</TableCell>
                  <TableCell>{row.acceptanceRate}%</TableCell>
                  <TableCell>{row.rejectionPpm.toLocaleString()}</TableCell>
                  <TableCell>{row.closedQmsAudits}</TableCell>
                  <TableCell>{row.majorFindings} / {row.minorFindings}</TableCell>
                  <TableCell className="font-semibold">{row.qualityScore}</TableCell>
                  <TableCell>{row.rating}</TableCell>
                </TableRow>
              ))}
              {!register.visibleItems.length && (
                <TableRow>
                  <TableCell colSpan={8} className="p-0">
                    <EmptyState
                      icon={ShieldCheck}
                      title="No supplier scorecards found"
                    />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <RegisterPagination
        page={register.page}
        pageCount={register.pageCount}
        onPageChange={register.setPage}
      />
    </PageContainer>
  );
}
