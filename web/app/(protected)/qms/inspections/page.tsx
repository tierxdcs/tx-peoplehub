'use client';
import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../../lib/api';
import { useQmsAccess } from '../../../lib/use-qms-access';
import { Button } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
type T = { id: string; name: string; status: string; templateType: string };
type OrderLine = {
  id: string;
  quantity: string;
  product: { name: string; sku: string };
};
type OrderOption = {
  id: string;
  orderNumber: string;
  customer: { name: string } | null;
  lineItems: OrderLine[];
};
type I = {
  id: string;
  inspectionNumber: string;
  inspectionType: string;
  status: string;
  batchOrSerial?: string;
  orderLine?: {
    product: { name: string; sku: string };
    order: { orderNumber: string };
  } | null;
};
export default function Inspections() {
  const { isQmsHead } = useQmsAccess(),
    [templates, setTemplates] = useState<T[]>([]),
    [items, setItems] = useState<I[]>([]),
    [orders, setOrders] = useState<OrderOption[]>([]),
    [templateId, setTemplate] = useState(''),
    [orderId, setOrderId] = useState(''),
    [orderLineId, setOrderLineId] = useState(''),
    [batch, setBatch] = useState('');
  const load = () =>
    Promise.all([
      apiFetch<T[]>('/qms/templates'),
      apiFetch<I[]>('/qms/inspections'),
      apiFetch<OrderOption[]>('/qms/references/order-lines'),
    ]).then(([t, i, o]) => {
      setTemplates(t.filter((x) => x.status === 'APPROVED'));
      setItems(i);
      setOrders(o);
    });
  useEffect(() => {
    load();
  }, []);
  const lineOptions =
    orders.find((o) => o.id === orderId)?.lineItems ?? [];
  async function create(e: FormEvent) {
    e.preventDefault();
    await apiFetch('/qms/inspections', {
      method: 'POST',
      body: JSON.stringify({
        templateId,
        batchOrSerial: batch || undefined,
        orderLineId: orderLineId || undefined,
      }),
    });
    setOrderId('');
    setOrderLineId('');
    setBatch('');
    await load();
  }
  async function review(id: string, result: string) {
    await apiFetch(`/qms/inspections/${id}/review/${result}`, {
      method: 'POST',
      body: '{}',
    });
    await load();
  }
  return (
    <PageContainer>
      <PageHeader
        title="Quality Inspections"
        description="One execution engine for incoming, in-process, final, FAT and dispatch checks"
      />
      <Card className="mb-6">
        <CardContent className="p-5">
          <form
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
            onSubmit={create}
          >
            <Select
              required
              value={templateId}
              onChange={(e) => setTemplate(e.target.value)}
            >
              <option value="">Approved template</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {t.templateType}
                </option>
              ))}
            </Select>
            <Select
              value={orderId}
              onChange={(e) => {
                setOrderId(e.target.value);
                setOrderLineId('');
              }}
            >
              <option value="">Order (optional)</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.orderNumber}
                  {o.customer ? ` · ${o.customer.name}` : ''}
                </option>
              ))}
            </Select>
            <Select
              value={orderLineId}
              disabled={!orderId}
              onChange={(e) => setOrderLineId(e.target.value)}
            >
              <option value="">
                {orderId ? 'Order line (optional)' : 'Select an order first'}
              </option>
              {lineOptions.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.product.name} ({l.product.sku}) · Qty {l.quantity}
                </option>
              ))}
            </Select>
            <Input
              value={batch}
              onChange={(e) => setBatch(e.target.value)}
              placeholder="Batch / serial"
            />
            <Button type="submit" className="lg:col-start-3">
              Start inspection
            </Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">
            Linking an inspection to an order line lets it satisfy that line’s QC
            gate in the Product Lifecycle Tracker. You can also link later from
            the inspection’s detail page.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-5">
          {items.map((i) => (
            <div
              className="flex flex-col items-stretch gap-3 border-b py-4 text-sm sm:flex-row sm:items-center sm:justify-between"
              key={i.id}
            >
              <div>
                <Link
                  className="font-medium text-primary"
                  href={`/qms/inspections/${i.id}`}
                >
                  {i.inspectionNumber} · {i.inspectionType} · {i.status}
                </Link>
                <div className="text-xs text-muted-foreground">
                  {i.orderLine
                    ? `Linked · ${i.orderLine.order.orderNumber} · ${i.orderLine.product.name} (${i.orderLine.product.sku})`
                    : 'Not linked to an order line'}
                </div>
              </div>
              {isQmsHead && i.status === 'PENDING_REVIEW' && (
                <div className="grid grid-cols-2 gap-3 sm:flex sm:gap-2">
                  <Button size="sm" onClick={() => review(i.id, 'PASS')}>
                    Pass
                  </Button>
                  <Button size="sm" onClick={() => review(i.id, 'FAIL')}>
                    Fail
                  </Button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
