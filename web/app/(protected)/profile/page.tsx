'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth-context';
import { apiFetch, ApiError } from '../../lib/api';
import { Employee, SignatureFont, Vertical } from '../../lib/types';
import { SIGNATURE_FONTS } from '../../lib/signature';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { SignatureEditorFields } from '../../components/ui/signature-setup-inline';
import { useToast } from '../../components/ui/toaster';

export default function ProfilePage() {
  const { user, loading: authLoading } = useAuth();
  const toast = useToast();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [verticalName, setVerticalName] = useState<string | null>(null);
  const [managerName, setManagerName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [sigText, setSigText] = useState('');
  const [sigFont, setSigFont] = useState<SignatureFont>(SIGNATURE_FONTS[0]);
  const [savingSig, setSavingSig] = useState(false);

  useEffect(() => {
    if (authLoading || !user) return;

    apiFetch<Employee>(`/employees/${user.sub}`)
      .then(async (me) => {
        setEmployee(me);
        setSigText(me.signatureText ?? '');
        setSigFont(me.signatureFont ?? SIGNATURE_FONTS[0]);

        if (me.verticalId) {
          // /verticals/me (own vertical) rather than the ADMIN-only
          // /verticals list — this page is reached by non-admins too.
          const vertical = await apiFetch<Vertical | null>('/verticals/me');
          setVerticalName(vertical?.name ?? null);
        }

        if (me.reportingManagerId) {
          const manager = await apiFetch<Employee>(
            `/employees/${me.reportingManagerId}`,
          );
          setManagerName(`${manager.firstName} ${manager.lastName}`);
        }
      })
      .finally(() => setLoading(false));
  }, [authLoading, user]);

  async function saveSignature() {
    if (!sigText.trim()) return;
    setSavingSig(true);
    try {
      const updated = await apiFetch<Employee>('/employees/me/signature', {
        method: 'PATCH',
        body: JSON.stringify({
          signatureText: sigText.trim(),
          signatureFont: sigFont,
        }),
      });
      setEmployee(updated);
      setSigText(updated.signatureText ?? '');
      setSigFont(updated.signatureFont ?? SIGNATURE_FONTS[0]);
      toast.success('Signature saved');
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Failed to save signature',
      );
    } finally {
      setSavingSig(false);
    }
  }

  if (authLoading || loading || !employee) return <p>Loading…</p>;

  return (
    <div>
      <h1>My Profile</h1>
      <dl>
        <dt>Name</dt>
        <dd>
          {employee.firstName} {employee.lastName}
        </dd>
        <dt>Employee ID</dt>
        <dd>{employee.employeeId}</dd>
        <dt>Vertical</dt>
        <dd>{verticalName ?? '—'}</dd>
        <dt>Manager</dt>
        <dd>{managerName ?? '—'}</dd>
        <dt>Role</dt>
        <dd>{employee.role}</dd>
      </dl>

      <Card className="mt-6 max-w-2xl">
        <CardHeader>
          <CardTitle>Signature</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <p className="text-sm text-muted-foreground">
            Your internal e-signature is applied when you approve requests. This
            is a display convenience, not a legally-binding e-signature.
          </p>
          <SignatureEditorFields
            text={sigText}
            font={sigFont}
            onTextChange={setSigText}
            onFontChange={setSigFont}
            disabled={savingSig}
          />
          <Button onClick={saveSignature} disabled={savingSig || !sigText.trim()}>
            {savingSig ? 'Saving…' : 'Save signature'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
