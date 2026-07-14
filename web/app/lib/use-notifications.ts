'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from './api';
import { useAuth } from './auth-context';

export type NotificationType =
  | 'CARD_ASSIGNED'
  | 'CARD_COMMENTED'
  | 'CARD_UPDATED';

export interface AppNotification {
  id: string;
  type: NotificationType;
  relatedCardId: string | null;
  message: string;
  isRead: boolean;
  createdAt: string;
}

/**
 * Personal in-app notifications (Kanban events). Polls the unread count on the
 * same 60s + window-focus cadence as the pending-approvals hook, and lazily
 * loads the list when the caller asks (e.g. the bell dropdown opens).
 */
export function useNotifications() {
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<AppNotification[]>([]);

  const refreshCount = useCallback(async () => {
    if (!user) return;
    try {
      const res = await apiFetch<{ count: number }>(
        '/notifications/unread-count',
      );
      setUnreadCount(res.count);
    } catch {
      // Non-fatal — a failed poll just leaves the badge as-is.
    }
  }, [user]);

  const loadList = useCallback(async () => {
    if (!user) return;
    try {
      const list = await apiFetch<AppNotification[]>('/notifications/me');
      setItems(list);
      setUnreadCount(list.filter((n) => !n.isRead).length);
    } catch {
      /* ignore */
    }
  }, [user]);

  const markRead = useCallback(async (id: string) => {
    // Optimistic: flip locally, then persist.
    setItems((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await apiFetch(`/notifications/${id}/read`, { method: 'PATCH' });
    } catch {
      /* ignore; next poll reconciles */
    }
  }, []);

  const markAllRead = useCallback(async () => {
    setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
    try {
      await apiFetch('/notifications/read-all', { method: 'PATCH' });
    } catch {
      /* ignore */
    }
  }, []);

  // Poll the count every 60s + on window focus (same pattern as approvals).
  useEffect(() => {
    if (!user) {
      setUnreadCount(0);
      setItems([]);
      return;
    }
    void refreshCount();
    const interval = setInterval(() => void refreshCount(), 60_000);
    const onFocus = () => void refreshCount();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [user, refreshCount]);

  return { unreadCount, items, loadList, markRead, markAllRead };
}
