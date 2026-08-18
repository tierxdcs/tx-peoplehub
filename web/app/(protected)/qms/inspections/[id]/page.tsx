'use client';
import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch, ApiError } from '../../../../lib/api';
import { Button } from '../../../../components/ui/button';
import { Card, CardContent } from '../../../../components/ui/card';
import { Input } from '../../../../components/ui/input';
import { Select } from '../../../../components/ui/select';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { useToast } from '../../../../components/ui/toaster';

type R = {
  questionKey: string;
  promptSnapshot: string;
  section: string;
  required: boolean;
  responseType: string;
  answer?: { value?: string };
};
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
  inspectionNumber: string;
  status: string;
  responses: R[];
  orderLine?: {
    product: { name: string; sku: string };
    order: { orderNumber: string };
  } | null;
};

// A failed/cancelled inspection can no longer be linked (matches the backend).
const LINKABLE = ['DRAFT', 'IN_PROGRESS', 'PENDING_REVIEW', 'PASSED', 'CONDITIONAL_PASS'];

export default function InspectionDetail() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [item, setItem] = useState<I>();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [orders, setOrders] = useState<OrderOption[]>([]);
  const [orderId, setOrderId] = useState('');
  const [orderLineId, setOrderLineId] = useState('');
  const [linking, setLinking] = useState(false);

  const load = () =>
    apiFetch<I>(`/qms/inspections/${id}`).then((x) => {
      setItem(x);
      setAnswers(
        Object.fromEntries(
          x.responses.map((r) => [r.questionKey, r.answer?.value ?? '']),
        ),
      );
    });
  useEffect(() => {
    load();
    apiFetch<OrderOption[]>('/qms/references/order-lines')
      .then(setOrders)
      .catch(() => setOrders([]));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const lineOptions = orders.find((o) => o.id === orderId)?.lineItems ?? [];

  async function complete(e: FormEvent) {
    e.preventDefault();
    if (!item) return;
    const responses = item.responses.map((r) => ({
      questionKey: r.questionKey,
      answer: { value: answers[r.questionKey] },
      result: ['PASS', 'YES', 'NA'].includes(answers[r.questionKey])
        ? 'PASS'
        : answers[r.questionKey] === 'FAIL' || answers[r.questionKey] === 'NO'
          ? 'FAIL'
          : undefined,
    }));
    const overallResult = responses.some((r) => r.result === 'FAIL')
      ? 'FAIL'
      : 'PASS';
    await apiFetch(`/qms/inspections/${id}/complete`, {
      method: 'POST',
      body: JSON.stringify({ responses, overallResult }),
    });
    await load();
  }

  async function link() {
    if (!orderLineId) return;
    setLinking(true);
    try {
      await apiFetch(`/qms/inspections/${id}/link`, {
        method: 'POST',
        body: JSON.stringify({ orderLineId }),
      });
      toast.success('Inspection linked to order line');
      setOrderId('');
      setOrderLineId('');
      await load();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Unable to link inspection',
      );
    } finally {
      setLinking(false);
    }
  }

  if (!item) return null;
  return (
    <PageContainer>
      <PageHeader
        title={item.inspectionNumber}
        description={`Inspection execution · ${item.status}`}
      />

      <Card className="mb-6">
        <CardContent className="p-5">
          <h3 className="text-sm font-semibold">Order line</h3>
          {item.orderLine ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Linked to <b>{item.orderLine.order.orderNumber}</b> ·{' '}
              {item.orderLine.product.name} ({item.orderLine.product.sku}). Once
              this inspection passes review, it satisfies that line’s QC gate in
              the Product Lifecycle Tracker.
            </p>
          ) : (
            <>
              <p className="mb-3 mt-1 text-sm text-muted-foreground">
                Not linked to an order line. Link it so a passed result can
                satisfy the line’s QC gate.
              </p>
              {LINKABLE.includes(item.status) ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Select
                    value={orderId}
                    onChange={(e) => {
                      setOrderId(e.target.value);
                      setOrderLineId('');
                    }}
                  >
                    <option value="">Select order</option>
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
                      {orderId ? 'Select order line' : 'Select an order first'}
                    </option>
                    {lineOptions.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.product.name} ({l.product.sku}) · Qty {l.quantity}
                      </option>
                    ))}
                  </Select>
                  <Button
                    type="button"
                    disabled={!orderLineId || linking}
                    onClick={() => void link()}
                  >
                    {linking ? 'Linking…' : 'Link to order line'}
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  A failed or cancelled inspection cannot be linked.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <form onSubmit={complete}>
        <Card>
          <CardContent className="p-5">
            {item.responses.map((r) => (
              <div
                className="grid gap-2 border-b py-4 md:grid-cols-2"
                key={r.questionKey}
              >
                <div>
                  <b>{r.promptSnapshot}</b>
                  <div className="text-xs text-muted-foreground">
                    {r.section}
                    {r.required ? ' · Required' : ''}
                  </div>
                </div>
                {['PASS_FAIL_NA', 'YES_NO_NA', 'OK_NOTOK_NA'].includes(
                  r.responseType,
                ) ? (
                  <Select
                    required={r.required}
                    value={answers[r.questionKey] ?? ''}
                    onChange={(e) =>
                      setAnswers({ ...answers, [r.questionKey]: e.target.value })
                    }
                  >
                    <option value="">Select</option>
                    {(r.responseType === 'PASS_FAIL_NA'
                      ? ['PASS', 'FAIL', 'NA']
                      : r.responseType === 'YES_NO_NA'
                        ? ['YES', 'NO', 'NA']
                        : ['OK', 'NOT OK', 'NA']
                    ).map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    required={r.required}
                    value={answers[r.questionKey] ?? ''}
                    onChange={(e) =>
                      setAnswers({ ...answers, [r.questionKey]: e.target.value })
                    }
                  />
                )}
              </div>
            ))}
            {['DRAFT', 'IN_PROGRESS'].includes(item.status) && (
              <Button className="mt-4" type="submit">
                Complete and submit for review
              </Button>
            )}
          </CardContent>
        </Card>
      </form>
    </PageContainer>
  );
}
