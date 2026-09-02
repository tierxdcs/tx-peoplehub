'use client';

import { Trash2 } from 'lucide-react';
import { apiFetch, ApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';
import { Button } from '../../../components/ui/button';
import { useConfirm } from '../../../components/ui/confirm';
import { useToast } from '../../../components/ui/toaster';

export function BomIntakeDeleteButton({
  id,
  productName,
  createdById,
  draft,
  onDeleted,
}: {
  id: string;
  productName: string;
  createdById: string;
  draft: boolean;
  onDeleted: () => void | Promise<void>;
}) {
  const { user } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const allowed =
    draft &&
    (user?.role === 'SUPER_ADMIN' || user?.sub === createdById);

  if (!allowed) return null;

  async function remove() {
    const ok = await confirm({
      title: `Delete Draft BOM intake for ${productName}?`,
      description:
        'This permanently removes the Draft intake. It cannot be deleted after submission, sourcing, pricing or release.',
      confirmLabel: 'Delete Draft',
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiFetch(`/customer-bom-intakes/${id}`, { method: 'DELETE' });
      toast.success('Draft BOM intake deleted.');
      await onDeleted();
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : 'Failed to delete Draft BOM intake',
      );
    }
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="destructive"
      onClick={(event) => {
        event.stopPropagation();
        void remove();
      }}
    >
      <Trash2 className="size-4" /> Delete
    </Button>
  );
}
