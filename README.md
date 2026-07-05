# tx-peoplehub

Modular ERP backend — foundation phase. A NestJS modular monolith with Prisma +
PostgreSQL, JWT auth (bearer access token + HTTP-only refresh cookie), RBAC, an
audit trail, and OpenAPI docs. ERP domains (HR, Finance, Inventory, Procurement)
plug in as new modules following the `users` reference pattern.

## Stack

- **NestJS** (TypeScript) — modular monolith
- **PostgreSQL** + **Prisma** ORM
- **Auth:** JWT access token + HTTP-only refresh cookie, RBAC via `@Roles`
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

# Create schema + seed the admin user
npm run prisma:migrate:dev    # creates the initial migration in dev
npm run prisma:seed

npm run start:dev             # http://localhost:3000  (docs at /docs)
```

Default seeded admin (override in `.env`):
`admin@peoplehub.local` / `ChangeMe123!`

## Auth flow

1. `POST /auth/login { email, password }` → returns `{ accessToken }` and sets the
   HTTP-only `peoplehub_rt` refresh cookie.
2. Send `Authorization: Bearer <accessToken>` on protected routes.
3. `POST /auth/refresh` (with the cookie) → new `{ accessToken }`.
4. `POST /auth/logout` → clears the cookie.

## Project structure

```
src/
├── core/          # config (env validation) + database (Prisma)
├── common/        # cross-cutting: guards, filters, interceptors, decorators, DTOs
└── modules/       # feature modules — one per ERP domain
    ├── auth/      # login / refresh / logout
    ├── users/     # REFERENCE module — copy this shape
    └── health/    # liveness + DB check (public)
```

## Adding a new ERP module (the recipe)

Copy the `users` module as your template. For a module `X`:

1. `src/modules/x/x.module.ts` — declares controller + service.
2. `x.service.ts` — inject `PrismaService`; put business logic here.
3. `x.controller.ts` — REST endpoints. Guard with `@UseGuards(RolesGuard)` +
   `@Roles('admin', ...)` as needed. Global `JwtAuthGuard` already enforces auth
   (use `@Public()` to opt a route out).
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
| `npm run prisma:seed` | Seed roles + admin user |
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
