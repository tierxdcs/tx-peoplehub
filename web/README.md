# tx-peoplehub web

Thin, functional-not-polished Next.js UI for the Employee & Access Management
backend. Proof-of-flow only — no design system, no styling beyond basic
usable layout.

## Setup

```bash
cd web
cp .env.local.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:3000
npm install
npm run dev                        # http://localhost:3001
```

Requires the NestJS API running separately on port 3000 (`npm run start:dev`
from the repo root), with `FRONTEND_ORIGIN=http://localhost:3001` in its
`.env` (already the default — see [.env.example](../.env.example)).

## Auth model

- Access token held in memory only (React context), never `localStorage`.
- Refresh token lives in the httpOnly `peoplehub_rt` cookie set by the API;
  `credentials: 'include'` on every request lets it flow automatically.
- On a 401, `apiFetch` silently retries once via `/auth/refresh` before
  surfacing the error.
- Route protection is client-side only (`(protected)/layout.tsx`,
  `(protected)/admin/layout.tsx`) — the real security boundary is the
  backend's `JwtAuthGuard`/`RolesGuard`.

## Structure

See `app/` — `lib/` holds the API client, JWT decode, and auth context;
route groups under `(protected)/` mirror the role-based screens (admin,
team, profile). No new backend routes were added for this UI.
