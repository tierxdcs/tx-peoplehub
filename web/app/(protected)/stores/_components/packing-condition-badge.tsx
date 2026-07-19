import { Badge } from '../../../components/ui/badge';
import { PACKING_CONDITION_LABEL, type PackingCondition } from '../../../lib/stores';

/**
 * Packing condition as a colored badge. A DAMAGED / PARTIALLY_DAMAGED receipt
 * is worth seeing at a glance in the GRN register, so it gets a warning/red
 * treatment rather than being buried in free-text.
 */
export function PackingConditionBadge({
  value,
}: {
  value: PackingCondition | null | undefined;
}) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const variant =
    value === 'GOOD' ? 'success' : value === 'DAMAGED' ? 'destructive' : 'warning';
  return <Badge variant={variant}>{PACKING_CONDITION_LABEL[value]}</Badge>;
}
