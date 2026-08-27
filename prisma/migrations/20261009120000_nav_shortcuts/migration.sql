-- Per-employee pinned sidebar shortcuts. Additive only: a new table, no change
-- to any existing one. Nothing is backfilled — every employee starts with no
-- pins and builds their own list.
CREATE TABLE "nav_shortcuts" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nav_shortcuts_pkey" PRIMARY KEY ("id")
);

-- One pin per route per employee: makes pinning idempotent and unpinning exact.
CREATE UNIQUE INDEX "nav_shortcuts_employeeId_href_key" ON "nav_shortcuts"("employeeId", "href");

-- The only read path is "this employee's pins, in display order".
CREATE INDEX "nav_shortcuts_employeeId_sortOrder_idx" ON "nav_shortcuts"("employeeId", "sortOrder");

ALTER TABLE "nav_shortcuts" ADD CONSTRAINT "nav_shortcuts_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
