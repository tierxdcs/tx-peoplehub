'use client';

import { formatINR } from '../../lib/sales';
import { useNumberFormat } from '../../lib/number-format-context';
import type { RfqProductBomExplosion } from '../../lib/rfq';
import { EmptyState } from '../ui/empty-state';
import { StatusBadge } from '../ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';

export function ExplodedBomTable({ result }: { result: RfqProductBomExplosion }) {
  const { style } = useNumberFormat();
  if (!result.lines.length) {
    return <EmptyState title="No sourcing requirements" description="This product has no linked released BOM, or its released BOM has no BUY components." />;
  }
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Item</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Required qty</TableHead><TableHead>UOM</TableHead><TableHead className="text-right">Unit cost</TableHead><TableHead className="text-right">Extended cost</TableHead>
        </TableRow></TableHeader>
        <TableBody>{result.lines.map((line) => (
          <TableRow key={line.itemId}>
            <TableCell><div className="font-medium">{line.itemCode}</div><div className="text-xs text-muted-foreground">{line.itemName}</div></TableCell>
            <TableCell><StatusBadge value={line.itemType} /></TableCell>
            <TableCell className="text-right font-medium">{line.requiredQuantity}</TableCell>
            <TableCell>{line.unitOfMeasure}</TableCell>
            <TableCell className="text-right">{line.unitCost == null ? <span className="text-amber-600">Cost unavailable</span> : formatINR(line.unitCost, style)}</TableCell>
            <TableCell className="text-right font-medium">{line.extendedCost == null ? '—' : formatINR(line.extendedCost, style)}</TableCell>
          </TableRow>
        ))}</TableBody>
      </Table>
    </div>
  );
}
