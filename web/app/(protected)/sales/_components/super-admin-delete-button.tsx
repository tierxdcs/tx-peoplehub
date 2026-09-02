'use client';

import { Trash2 } from 'lucide-react';
import { apiFetch, ApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';
import { Button } from '../../../components/ui/button';
import { useConfirm } from '../../../components/ui/confirm';
import { useToast } from '../../../components/ui/toaster';

type PipelineEntryType =
  | 'leads'
  | 'opportunities'
  | 'bids'
  | 'orders'
  | 'bom-intakes';

export function SuperAdminDeleteButton({
  type,
  id,
  label,
  onDeleted,
}: {
  type: PipelineEntryType;
  id: string;
  label: string;
  onDeleted: () => void | Promise<void>;
}) {
  const { user } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();

  if (user?.role !== 'SUPER_ADMIN') return null;

  async function remove() {
    const ok = await confirm({
      title: `Delete ${label}?`,
      description:
        'This permanently deletes the Sales Pipeline entry. The action is unavailable when protected downstream records still depend on it.',
      confirmLabel: 'Delete permanently',
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiFetch(`/sales-pipeline-admin/${type}/${id}`, {
        method: 'DELETE',
      });
      toast.success(`${label} deleted.`);
      await onDeleted();
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : `Failed to delete ${label}`,
      );
    }
  }

  return (
    <Button
      type="button"
      variant="destructive"
      size="sm"
      onClick={(event) => {
        event.stopPropagation();
        void remove();
      }}
    >
      <Trash2 className="size-4" /> Delete
    </Button>
  );
}
