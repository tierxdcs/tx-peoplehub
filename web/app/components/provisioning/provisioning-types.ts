export type ProvisioningRequest = {
  id: string;
  status: 'PENDING_APPROVAL' | 'REJECTED' | 'APPROVED' | 'SENT_TO_SCM' | 'FULFILLED' | 'COMPLETED';
  rejectionComment: string | null;
  createdAt: string;
  approvedAt: string | null;
  fulfilledAt: string | null;
  completedAt: string | null;
  employee: { id: string; employeeId: string; firstName: string; lastName: string; designation: string | null };
  itemType: { id: string; name: string; requiresScmFulfillment: boolean; approverType: 'SUPER_ADMIN' | 'VERTICAL_OWNER'; approverVertical: { id: string; name: string; code: string; ownerId: string | null } | null };
};
