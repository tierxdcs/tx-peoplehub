import { cn } from '../../lib/utils';

export function BusinessUnitLabel({
  name,
  colorHex = '#64748B',
  className,
}: {
  name: string | null | undefined;
  colorHex?: string | null;
  className?: string;
}) {
  if (!name) return <span className="text-muted-foreground">—</span>;
  const color = colorHex || '#64748B';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        className,
      )}
      style={{
        color,
        borderColor: `${color}33`,
        backgroundColor: `${color}0D`,
      }}
    >
      <span
        className="size-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {name}
    </span>
  );
}
