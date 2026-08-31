-- Web Push subscriptions, one row per browser/device that an employee allowed
-- notifications on. Additive only: a new table, no change to any existing one,
-- nothing backfilled — every employee starts with no devices and opts in from
-- their profile page by an explicit tap.
--
-- Holds only what the browser's PushManager.subscribe() hands back (the push
-- service endpoint plus that device's encryption keys). Our VAPID private key
-- is NOT here and never will be; it lives in the environment, so this table on
-- its own cannot be used to send anything.
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "lastPushAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- Globally unique, not per employee: the push service owns the endpoint, and on
-- a shared device the endpoint must belong to exactly one employee — whoever
-- most recently allowed notifications there — or one person's notifications
-- would be delivered to the other.
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- The only read path is "every device belonging to this employee".
CREATE INDEX "push_subscriptions_employeeId_idx" ON "push_subscriptions"("employeeId");

ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
