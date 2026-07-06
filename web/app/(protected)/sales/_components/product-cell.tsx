/**
 * Renders a line-item's product as name (primary) + SKU (secondary). Shared by
 * every Sales line-item table (Bid detail, Order detail, …) so the two never
 * drift — the backend resolves productName/productSku onto each line item, and
 * this is the single place that formats them for display. Never show the raw
 * productId FK.
 */
export function ProductCell({
  name,
  sku,
}: {
  name: string;
  sku: string;
}) {
  return (
    <div>
      <div className="font-medium">{name}</div>
      <div className="text-xs text-muted-foreground">SKU: {sku}</div>
    </div>
  );
}
