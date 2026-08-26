-- Executive Dashboards access grant. Deliberately NOT backfilled from any
-- vertical, role or designation: the flag is a discretionary CEO grant, so
-- every existing employee starts without it and SUPER_ADMIN is treated as an
-- implicit holder in the access layer (no row needs to change for the CEO).
ALTER TABLE "employees"
ADD COLUMN "hasExecutiveDashboardAccess" BOOLEAN NOT NULL DEFAULT false;
