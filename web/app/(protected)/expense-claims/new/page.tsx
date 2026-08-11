'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ApiError } from '../../../lib/api';
import { createClaim } from '../../../lib/expense-claims';
import { useToast } from '../../../components/ui/toaster';
import { PageContainer } from '../../../components/ui/page-container';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Field } from '../../../components/ui/field';

export default function NewExpenseClaimPage() {
  const router = useRouter();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    try {
      const claim = await createClaim({ title: title.trim() });
      toast.success(`Claim ${claim.claimNumber} created`);
      router.push(`/expense-claims/${claim.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to create claim');
      setSubmitting(false);
    }
  }

  return (
    <PageContainer>
      <Link
        href="/expense-claims"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to my claims
      </Link>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">
        New expense claim
      </h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSubmit();
            }}
            className="space-y-4"
          >
            <Field
              label="Title"
              htmlFor="claim-title"
              required
              hint="A short description, e.g. “August client-visit travel”. You'll add expense lines and receipts on the next screen."
            >
              <Input
                id="claim-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={160}
                required
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push('/expense-claims')}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!title.trim() || submitting}>
                {submitting ? 'Creating…' : 'Create claim'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
