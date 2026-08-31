'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, Info, Send, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { useToast } from '../ui/toaster';
import {
  fetchPushConfig,
  fetchPushDevices,
  hasLocalSubscription,
  revokePushDevice,
  sendTestPush,
  subscribeToPush,
  unsubscribeFromPush,
  type PushDevice,
} from '../../lib/push';
import { pushAvailability, readEnvironment, type PwaEnvironment } from '../../lib/pwa';

/**
 * "Notifications" on the profile page: turn push on for this device, prove it
 * works, and manage the devices already subscribed.
 *
 * Two rules shape this component:
 *
 * 1. **The permission prompt only ever happens inside a click handler.** iOS
 *    rejects a permission request that is not tied to an explicit user gesture,
 *    and Chrome penalises pages that ask on load. So nothing in the mount effect
 *    prompts — it only reads state.
 * 2. **A successful API call is not a delivered notification.** The test button
 *    reports what the push service accepted and says plainly that the phone is
 *    the real proof, rather than claiming success on a 200.
 */
export function NotificationsCard() {
  const toast = useToast();
  const [env, setEnv] = useState<PwaEnvironment | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [serverConfigured, setServerConfigured] = useState<boolean | null>(null);
  const [devices, setDevices] = useState<PushDevice[]>([]);
  const [subscribedHere, setSubscribedHere] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [config, list, local] = await Promise.all([
      fetchPushConfig(),
      fetchPushDevices(),
      hasLocalSubscription().catch(() => false),
    ]);
    setServerConfigured(config.configured);
    setPublicKey(config.publicKey);
    setDevices(list);
    setSubscribedHere(local);
  }, []);

  useEffect(() => {
    // Reading permission state is not asking for it — no prompt happens here.
    setEnv(readEnvironment());
    refresh().catch(() => {
      setServerConfigured(false);
    });
  }, [refresh]);

  const enable = async () => {
    if (!publicKey) return;
    setBusy(true);
    try {
      // Inside the click handler, as iOS requires.
      await subscribeToPush(publicKey);
      await refresh();
      setEnv(readEnvironment());
      toast.success(
        'This device will now receive notifications. Send a test to confirm they arrive.',
        'Notifications on',
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Notifications could not be enabled.',
      );
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      await unsubscribeFromPush();
      await refresh();
      toast.toast({
        title: 'Notifications off',
        description: 'This device will no longer receive notifications.',
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Notifications could not be turned off.',
      );
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      const result = await sendTestPush();
      await refresh();
      if (result.delivered === 0) {
        // Never call this a success. Nothing reached a device.
        toast.error(
          result.skipped === 'no-devices'
            ? 'No subscribed devices — turn notifications on first.'
            : `No device accepted the notification (${result.failed} failed, ${result.expired} expired).`,
          'Test not delivered',
        );
        return;
      }
      toast.toast({
        variant: 'success',
        title: 'Test sent',
        description: `Accepted for ${result.delivered} device(s). It should appear within a few seconds — if it doesn't, it did not arrive, whatever this message says.`,
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'The test notification failed.',
      );
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (device: PushDevice) => {
    setBusy(true);
    try {
      setDevices(await revokePushDevice(device.id));
      setSubscribedHere(await hasLocalSubscription().catch(() => false));
      toast.toast({
        title: 'Device removed',
        description: `${device.label} will no longer receive notifications.`,
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'The device could not be removed.',
      );
    } finally {
      setBusy(false);
    }
  };

  // Wait for both answers before rendering anything opinionated: a flash of
  // "not supported" that turns into a working button is worse than a beat of
  // nothing.
  if (!env || serverConfigured === null) return null;

  const availability = pushAvailability(env);

  return (
    <Card className="mt-4 max-w-2xl">
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div className="flex gap-3 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" />
          <p>
            Push notifications arrive on this device even when the app is closed.
            They are separate from email — turning them on here changes nothing
            about the emails you receive.
          </p>
        </div>

        {!serverConfigured ? (
          <p className="text-sm text-muted-foreground">
            Push notifications are not set up on this server yet.
          </p>
        ) : !availability.canSubscribe && !subscribedHere ? (
          <p className="text-sm text-muted-foreground">{availability.message}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {subscribedHere ? (
              <>
                <Button variant="outline" onClick={test} disabled={busy}>
                  <Send className="size-4" />
                  Send a test notification
                </Button>
                <Button variant="ghost" onClick={disable} disabled={busy}>
                  <BellOff className="size-4" />
                  Turn off on this device
                </Button>
              </>
            ) : (
              <Button onClick={enable} disabled={busy || !publicKey}>
                <Bell className="size-4" />
                Turn on notifications
              </Button>
            )}
          </div>
        )}

        {devices.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Your devices
            </p>
            <ul className="divide-y rounded-md border">
              {devices.map((device) => (
                <li
                  key={device.id}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {device.label}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {device.lastPushAt
                        ? `Last notification ${new Date(device.lastPushAt).toLocaleString()}`
                        : 'No notification sent yet'}
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => revoke(device)}
                    disabled={busy}
                    aria-label={`Remove ${device.label}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
