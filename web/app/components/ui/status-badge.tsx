import { Badge } from './badge';
import { statusVariant, humanizeEnum } from '../../lib/status';

/**
 * Renders any status/priority/role enum with the app-wide consistent color
 * (see lib/status.ts) and humanized label. This is the single component every
 * page uses to show a status value — no per-page color choices.
 */
export function StatusBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return <Badge variant={statusVariant(value)}>{humanizeEnum(value)}</Badge>;
}
