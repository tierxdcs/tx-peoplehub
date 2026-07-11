# tx-peoplehub

Modular ERP backend. A NestJS modular monolith with Prisma + PostgreSQL, JWT
auth (bearer access token + HTTP-only refresh cookie), role- and
hierarchy-based access control, an audit trail, and OpenAPI docs. The
`employees`/`verticals` modules are the access-control backbone: employees
belong to a business vertical and an optional reporting manager, with
`SUPER_ADMIN`/`ADMIN`/`MANAGER`/`EMPLOYEE` roles. Operational ERP domains
(Sales, HR, Production, ...) plug in as new modules following the `employees`
reference pattern, scoped by role + vertical + manager subtree.

## Stack

- **NestJS** (TypeScript) — modular monolith
- **PostgreSQL** + **Prisma** ORM
- **Auth:** JWT access token + HTTP-only refresh cookie, RBAC via `@Roles`
- **Access model:** `Employee` (role + vertical + reporting manager),
  `Vertical` (business unit table, extensible without a deploy)
- **Docs:** Swagger/OpenAPI at `/docs`
- **Deploy:** Railway (backend + managed Postgres); Next.js frontend on Vercel (later)

## Prerequisites

- Node.js 20+
- A PostgreSQL database (local via Docker, or a connection string)

## Setup

```bash
cp .env.example .env          # then edit secrets
npm install

# Option A — local Postgres via Docker
docker compose up -d postgres

# Create schema + seed 7 verticals + a SUPER_ADMIN employee
npm run prisma:migrate:dev    # creates the initial migration in dev
npm run prisma:seed

npm run start:dev             # http://localhost:3000  (docs at /docs)
```

Default seeded super admin (override in `.env`):
`nithin.gangadhar@phaze-dynamics.com` / `ChangeMe123!` — has no vertical/manager, and can
only create `ADMIN` accounts and onboard the rest of the org via `POST
/employees`. There is no self-registration; onboarding is always
admin-initiated, and the admin sets the employee's initial password directly.

## Auth flow

1. `POST /auth/login { email, password }` → returns `{ accessToken }` and sets the
   HTTP-only `peoplehub_rt` refresh cookie.
2. Send `Authorization: Bearer <accessToken>` on protected routes.
3. `POST /auth/refresh` (with the cookie) → new `{ accessToken }`.
4. `POST /auth/logout` → clears the cookie.

## Access model

- **Roles:** `SUPER_ADMIN` (only role that can create `ADMIN`s, no operational
  visibility), `ADMIN` (manages employee identity/access across all
  verticals, never sees operational data), `MANAGER` (own vertical, plus
  every downstream report — direct and indirect), `EMPLOYEE` (own records
  only).
- **Verticals** are a database table (`Sales`, `HR`, `Production`, `SCM`,
  `R&D`, `Accounts`, `Design` seeded), not an enum — add new ones via `POST
  /verticals`, no deploy required.
- **Hierarchy:** every employee except `SUPER_ADMIN` has a required
  `verticalId` and `reportingManagerId`. `GET /employees/:id/team` returns a
  manager's full downstream subtree (recursive, arbitrary depth) — this is
  the endpoint future operational modules call to scope their own queries to
  "me + my reports."
- **Soft delete only:** `PATCH /employees/:id/deactivate` sets
  `status=INACTIVE`; deactivated employees are never removed, so historical
  records they created stay attributable.

## Project structure

```
src/
├── core/          # config (env validation) + database (Prisma)
├── common/        # cross-cutting: guards, filters, interceptors, decorators, DTOs
└── modules/       # feature modules — one per ERP domain
    ├── auth/        # login / refresh / logout
    ├── employees/    # REFERENCE module — copy this shape; also the access-control backbone
    ├── verticals/    # business-unit table (Sales, HR, ...)
    └── health/       # liveness + DB check (public)
```

## Adding a new ERP module (the recipe)

Copy the `employees` module as your template. For a module `X`:

1. `src/modules/x/x.module.ts` — declares controller + service.
2. `x.service.ts` — inject `PrismaService`; put business logic here.
3. `x.controller.ts` — REST endpoints. Guard with `@UseGuards(RolesGuard)` +
   `@Roles(Role.ADMIN, ...)` as needed. Global `JwtAuthGuard` already enforces
   auth (use `@Public()` to opt a route out). For operational modules, scope
   query results to the caller's vertical and — for managers — their
   downstream subtree via `EmployeesService.getTeam()`.
4. `dto/create-x.dto.ts`, `dto/update-x.dto.ts` — validated inputs
   (`class-validator` + Swagger decorators).
5. `entities/x.entity.ts` — the public response shape (never expose secrets).
6. Add the Prisma model to `prisma/schema.prisma`, then
   `npm run prisma:migrate:dev`.
7. Register the module in `src/app.module.ts` `imports`.
8. Add `x.service.spec.ts` (unit) and extend the e2e suite.

Mutating routes (POST/PUT/PATCH/DELETE) are automatically recorded to the
`audit_logs` table by the global `AuditInterceptor`. Opt out with `@NoAudit()`.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run start:dev` | Run with hot reload |
| `npm run build` | Compile to `dist/` |
| `npm run prisma:migrate:dev` | Create/apply a dev migration |
| `npm run prisma:migrate` | Apply migrations (prod/`migrate deploy`) |
| `npm run prisma:seed` | Seed verticals + super admin |
| `npm run test` | Unit tests |
| `npm run test:e2e` | E2E tests (needs running + seeded DB) |
| `npm run lint` | Lint + autofix |

## Deployment (Railway)

1. Create a Railway project; add a **PostgreSQL** plugin (provides `DATABASE_URL`).
2. Deploy this repo — Railway builds from the `Dockerfile` (see `railway.json`).
3. Set env vars: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `FRONTEND_ORIGIN`
   (your Vercel URL), `NODE_ENV=production`.
4. On release the container runs `prisma migrate deploy` then starts the server.
   Health checks hit `/health`.

The frontend (Next.js on Vercel) comes in a later phase; CORS + the refresh
cookie are already configured to support a separate frontend origin.

## Out of scope (this phase)

- ERP business modules (HR, Finance, Inventory, Procurement)
- AI/Claude integration
- Frontend/UI
- Multi-tenancy (single company only)
