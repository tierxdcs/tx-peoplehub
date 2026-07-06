# Staging Deployment — Backend (Railway) + Frontend (Vercel)

Backend = NestJS API on **Railway** (Docker, `railway.json` + `Dockerfile`).
Frontend = Next.js on **Vercel**. They are two separate deployments that must
know each other's public URL. Use a **fresh Railway Postgres** for staging —
never point it at your local/dev database.

> **Tester data note:** real employee accounts for login ≠ real personal data
> for content. Testers log in with their own work email, but must enter
> **synthetic, valid-format** PAN / Aadhaar / bank details when testing HR
> onboarding. No real statutory/financial data belongs in a shared test env.

---

## Backend environment variables (Railway)

Validated at boot by Joi (`src/core/config/env.validation.ts`) — the container
**fails to start** if a required var is missing or malformed.

### Required — boot crashes if missing
| Variable | Notes |
|---|---|
| `DATABASE_URL` | Railway-provisioned Postgres connection string (the Postgres plugin injects this automatically when linked). |
| `JWT_ACCESS_SECRET` | New random string for staging — **do not reuse dev.** `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | Separate new random string. `openssl rand -hex 32` |
| `ENCRYPTION_KEY` | **Hard format rule:** must be base64 that decodes to **exactly 32 bytes**, else Joi rejects it and the app won't boot. Generate **only** with `openssl rand -base64 32`. Encrypts PAN/PF/ESIC/bank columns — **no recovery path if lost** (by design). Store in a password manager / Railway secrets, never in chat or plaintext. |

### Set explicitly for staging (defaults are dev-oriented and wrong when hosted)
| Variable | Value |
|---|---|
| `NODE_ENV` | `production` — **load-bearing.** It flips the refresh cookie to `secure: true` + `sameSite: 'none'`, which cross-site Railway↔Vercel auth requires. Without it, login silently fails in the browser. |
| `FRONTEND_ORIGIN` | The exact Vercel URL — protocol + domain, **no trailing slash** (e.g. `https://your-app.vercel.app`). CORS and the refresh cookie depend on an exact match. |
| `TIMEZONE` | `Asia/Kolkata` (IST) — calendar-day logic for leave/attendance. |

### Safe to omit (defaults apply)
`JWT_ACCESS_TTL` (`900s`), `JWT_REFRESH_TTL` (`7d`), `REFRESH_COOKIE_NAME`
(`peoplehub_rt`), `PORT` (Railway sets this; the app reads it).

> `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` are only read by the seed script,
> which you run **from your laptop** (see below) — they are **not** needed as
> Railway service vars.

---

## Frontend environment variables (Vercel)

Exactly two:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | The Railway backend's public URL (protocol + domain, no trailing slash). |
| `NEXT_PUBLIC_PAYSLIPS_ENABLED` | `false` — keep the employee payslip screen gated until payroll rates have compliance sign-off. |

---

## Migrations & seed

**Migrations run automatically** on every deploy: the container `CMD` is
`npx prisma migrate deploy && node dist/main.js` (see `Dockerfile` /
`railway.json`). `migrate deploy` (never `migrate dev`) applies committed
migrations against the target DB. `prisma` is a production dependency, so the
CLI is present in the runtime image — no per-boot download.

**Seed must run from your local machine**, not inside the container — the
runtime image is dev-dependency-stripped, so `ts-node` (which runs the seed)
isn't available there. After the first deploy's migration succeeds, from a
local checkout with full deps installed:

```bash
DATABASE_URL="<railway-staging-connection-string>" \
SEED_ADMIN_EMAIL="you@yourco.com" \
SEED_ADMIN_PASSWORD="<a-strong-password>" \
npm run prisma:seed
```

Use Railway's **public** connection string (the internal `*.railway.internal`
host is only reachable from inside Railway). The seed is idempotent and inserts:

- **1 `SUPER_ADMIN`** (email/password from the env vars above) — created only if that email doesn't already exist.
- **7 `Vertical`s** — Sales, HR, Production, SCM, R&D, Accounts, Design (upsert by code).
- **4 `LeaveType`s** — CL, SL, EL, UL (upsert by code).
- **8 `BidAssessmentQuestion`s** — inserted only when the table is empty (so it never clobbers Admin edits on a re-seed).

It inserts **no** employee/statutory data — testers create their own via the real onboarding flow.

---

## Bootstrap sequence (first deploy)

1. **Backend → Railway.** Provision a fresh Postgres, set the env vars above, deploy. Confirm the deploy log shows `prisma migrate deploy` applying migrations cleanly, and `GET /health` returns `{"status":"ok","db":"up"}`.
2. **Seed from your laptop** against the staging `DATABASE_URL` (command above).
3. **Frontend → Vercel.** Set the two `NEXT_PUBLIC_*` vars, deploy.
4. **Log in as the seeded SuperAdmin.** If this fails it's almost always a `FRONTEND_ORIGIN` mismatch (wrong domain, trailing slash, or `http` vs `https`) or `NODE_ENV` not being `production`.
5. **Onboard 2–3 testers** (SuperAdmin/Admin) with their real work emails + **synthetic** statutory/bank data; spread them across Sales and HR verticals so both modules get exercised with correctly-scoped access.
6. **Designate a Sales Head** — `PATCH /employees/:id/designate-sales-head` (Admin/SuperAdmin only) on one Sales-vertical tester. Without it, the Bid/No-Bid gate falls back to SuperAdmin approval — functional, but not the intended flow. Confirm the "Sales Head" badge shows for that employee.
7. **Grant access** to each tester; confirm each can log in with their own credentials.

---

## Smoke test (before announcing)

- [ ] SuperAdmin login works end-to-end (exercises CORS + cross-site cookie).
- [ ] HR onboarding: create employee → grant access → new employee logs in.
- [ ] Encrypted fields are actually ciphertext in the staging DB (don't assume `ENCRYPTION_KEY` was picked up just because the deploy succeeded — inspect a row).
- [ ] Leave: request → approval → balance deduction.
- [ ] Cross-vertical onboarding (HR onboards someone into Sales) works in staging, not just locally.
- [ ] Payroll employee-facing payslip route stays gated (`NEXT_PUBLIC_PAYSLIPS_ENABLED=false`).
- [ ] Refresh-token flow: log in, let the access token expire (or force it), confirm silent refresh rather than a forced re-login. (This is the real cross-site-cookie test.)
- [ ] Sales pipeline: Lead → Opportunity → Bid → Order.
- [ ] Bid/No-Bid gate: `POST /bids` blocked with no assessment → submit → reject w/ comment (as Sales Head) → still blocked → resubmit → approve → bid creation now succeeds.
- [ ] The 8 seeded assessment questions actually appear in the submit form (verify the seed ran against staging, don't assume).
- [ ] Sales-vertical-wide read visibility: a Sales `EMPLOYEE` can view a **peer's** bid/lead/opportunity/order (reads are vertical-wide; writes stay owner/hierarchy-scoped). Tell testers to expect this.

---

## Known fragilities already addressed in the repo

- **Prisma CLI in the runtime image** — `prisma` was moved from `devDependencies` to `dependencies`, so in-container `migrate deploy` uses the bundled CLI instead of downloading it on every boot.
- **Seed can't run in-container** — dev deps are stripped from the runtime image, so the seed runs from your laptop (documented above). This is intentional, not a bug.
- **Prisma CLI hang on boot** — `migrate deploy` finishes its work but the CLI can hang on a background telemetry/checkpoint call in a restricted-network container, blocking the chained app start. `ENV CHECKPOINT_DISABLE=1` is baked into the runtime stage of the `Dockerfile`, so **every** environment (staging, a future production Railway service, CI image builds) inherits it automatically — do **not** re-add `CHECKPOINT_DISABLE` as a per-environment Railway env var.

## Not included (flag if you want them)

- CI/CD auto-deploy on push (GitHub Actions → Railway/Vercel) — currently manual/on-demand.
- Error tracking (Sentry) — worth it once real bug reports start.
- Custom domain — default `*.railway.app` / `*.vercel.app` subdomains are fine for internal testing.

## Announce to testers

- This is a **non-persistent test environment** — data may be wiped; don't treat entries as durable.
- Use **your own login**, but **synthetic** PAN/Aadhaar/bank values.
- State a **feedback channel** for bug reports.
- Be clear on **what's testable now vs. coming soon** (e.g. if Sales lands in a later deploy).
- Expect a **more polished UI** (shadcn/Tailwind pass) than earlier walkthroughs; a not-yet-restyled corner isn't "broken."
