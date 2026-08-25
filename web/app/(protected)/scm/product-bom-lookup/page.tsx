'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileSearch, Send } from 'lucide-react';
import { ApiError } from '../../../lib/api';
import { getRfqProductBomExplosion, listRfqProductBomOptions, type RfqProductBomExplosion, type RfqProductBomOption } from '../../../lib/rfq';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Field } from '../../../components/ui/field';
import { ItemPicker } from '../../../components/ui/item-picker';
import { Skeleton } from '../../../components/ui/skeleton';
import { useToast } from '../../../components/ui/toaster';
import { ExplodedBomTable } from '../../../components/scm/exploded-bom-table';

export default function ProductBomLookupPage() {
  const router = useRouter();
  const toast = useToast();
  const [products, setProducts] = useState<RfqProductBomOption[]>([]);
  const [productId, setProductId] = useState('');
  const [result, setResult] = useState<RfqProductBomExplosion | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [loading, setLoading] = useState(true);
  const [loadingBom, setLoadingBom] = useState(false);
  const pickerItems = useMemo(() => products.map((product) => ({ id: product.productId, itemCode: product.sku, name: product.productName, itemType: product.itemType })), [products]);

  useEffect(() => { void listRfqProductBomOptions().then(setProducts).catch(() => toast.error('Failed to load products')).finally(() => setLoading(false)); }, [toast]);

  async function selectProduct(id: string) {
    setProductId(id); setResult(null);
    if (!id) return;
    setLoadingBom(true);
    try { setResult(await getRfqProductBomExplosion(id, 1)); }
    catch (error) { toast.error(error instanceof ApiError ? error.message : 'Failed to explode product BOM'); }
    finally { setLoadingBom(false); }
  }

  const validQuantity = Number(quantity) > 0 && Number.isFinite(Number(quantity));
  return <PageContainer>
    <PageHeader title="Product BOM Lookup" description="Search a catalogue product, review its Make/Buy-aware sourcing BOM for one unit, and raise an RFQ directly." />
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><FileSearch className="size-5" /> Product</CardTitle></CardHeader>
      <CardContent><Field label="Search product by SKU or name">
        {loading ? <Skeleton className="h-11 w-full" /> : <ItemPicker items={pickerItems} value={productId} onValueChange={selectProduct} placeholder="Search products…" />}
      </Field></CardContent>
    </Card>
    {loadingBom ? <Skeleton className="mt-4 h-64 w-full" /> : result ? <Card className="mt-4">
      <CardHeader><CardTitle>{result.product.name} <span className="ml-2 text-sm font-normal text-muted-foreground">{result.product.sku} · quantities per 1 unit</span></CardTitle></CardHeader>
      <CardContent className="space-y-5">
        {!result.isCostComplete && result.lines.length > 0 ? <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">Cost data is incomplete for one or more components.</div> : null}
        <ExplodedBomTable result={result} />
        <div className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
          <Field label="Quantity to source" className="w-52"><Input type="number" min="0.0001" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></Field>
          <Button disabled={!validQuantity || result.lines.length === 0} onClick={() => router.push(`/scm/rfqs/new?productId=${encodeURIComponent(productId)}&quantity=${encodeURIComponent(quantity)}`)}><Send className="mr-2 size-4" />Create RFQ</Button>
          <p className="text-sm text-muted-foreground">The RFQ remains editable before submission and follows the existing PM approval workflow.</p>
        </div>
      </CardContent>
    </Card> : null}
  </PageContainer>;
}
