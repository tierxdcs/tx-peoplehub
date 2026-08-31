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
| `NODE_ENV` | `production` — **load-bearing.** It flips the refresh cookie to `secure: true` + `sameSite: 'none'`, which cross-**origin** browser→API auth requires. Without it the cookie drops to `sameSite: 'lax'` with no `secure` flag and login silently fails in every browser. |
| `FRONTEND_ORIGIN` | The exact frontend URL — protocol + domain, **no trailing slash**. CORS and the refresh cookie depend on an exact match. **Must be on the same registrable domain as the API** — see below; a `*.vercel.app` frontend talking to a `*.up.railway.app` API breaks sign-in persistence on every iPhone. |
| `TIMEZONE` | `Asia/Kolkata` (IST) — calendar-day logic for leave/attendance. |

> ### The API and the frontend must be on the same domain (not optional on iOS)
>
> Sign-in survives closing the app because of one httpOnly refresh cookie with a
> 7-day lifetime; on launch the app calls `POST /auth/refresh` and silently gets a
> new access token (the access token itself is in-memory only and is *meant* to
> die with the process).
>
> If the API is on a different registrable domain than the frontend
> (`app.vercel.app` → `api.up.railway.app`), that cookie is a **third-party
> cookie**. WebKit blocks third-party cookie storage outright, and every browser
> on iOS is WebKit — an installed PWA included. The result is subtle and easy to
> misread as intended behaviour: login works, the session works, and then **every
> cold start lands on the login screen**, while iOS sessions also silently cap out
> at the 15-minute access-token TTL. Desktop Chrome still allows third-party
> cookies, so it all looks fine there.
>
> **So give the Railway service a custom domain under the same apex as the
> frontend** — e.g. app at `phazeone.phaze-dynamics.com`, API at
> `api.phaze-dynamics.com`. Then the cookie is first-party and the 7-day
> `maxAge` is honoured.
>
> **Prerequisite:** the *frontend* must be on that apex too. Two subdomains of
> one registrable domain is what makes the cookie first-party — an API at
> `api.phaze-dynamics.com` talking to an app still on `*.vercel.app` is no better
> than before. If the app is still on its Vercel-assigned URL, add a Vercel
> custom domain (`phazeone.<your-apex>`) first; that half is the same kind of
> CNAME work as step 2.
>
> One-time setup:
>
> 1. Railway → the backend service → **Settings → Networking → Custom Domain** →
>    add `api.<your-apex>`; Railway shows a CNAME target.
> 2. Add that `CNAME` in the apex domain's DNS zone. Wait for Railway to report
>    the domain as active (it issues the certificate itself).
> 3. Railway: set `FRONTEND_ORIGIN` to the frontend's custom domain.
> 4. Vercel: set `NEXT_PUBLIC_API_URL` to `https://api.<your-apex>` — then
>    **redeploy**. `NEXT_PUBLIC_*` values are inlined at build time, so editing
>    the variable alone changes nothing until the app is rebuilt.
> 5. **On every phone that already has the app installed: delete the home-screen
>    icon and re-install from the new domain**, then sign in and re-enable
>    notifications from Profile → Notifications. A PWA's identity *is* its
>    origin — the installed copy is pinned to the old one, so it keeps talking to
>    the old API and keeps asking for credentials no matter what the DNS says.
>    Its push subscription is origin-scoped for the same reason; the stale rows
>    need no cleanup (they prune themselves on the first 404/410 — see
>    `PushService`), but the new install does need permission granted again.
> 6. Verify on a real iPhone: sign in to the installed PWA, force-close it,
>    reopen — it should land on the dashboard, not the login screen.
>
> **`FRONTEND_ORIGIN` is one origin, not a list** (`main.ts`, `enableCors`), so
> step 3 is a cutover rather than an addition: the moment it changes, the old
> `*.vercel.app` URL starts failing CORS even though the page still loads. Two
> things follow. Use the custom domain from then on and re-bookmark accordingly;
> and note that **already-sent** vendor/supplier invite, PLM vendor-update and
> RFQ quote emails carry links built from the old origin, so those recipients
> need a re-sent link. Mail sent after the change is fine.
>
> No application code changes for any of this. `sameSite: 'none'` + `secure`
> stays correct once the domains match (a same-site subdomain request satisfies
> it), and the cookie is deliberately host-only — do **not** add a `domain=`
> attribute, which would share it with every subdomain of the apex.

### Safe to omit (defaults apply)
`JWT_ACCESS_TTL` (`900s`), `JWT_REFRESH_TTL` (`7d`), `REFRESH_COOKIE_NAME`
(`peoplehub_rt`), `PORT` (Railway sets this; the app reads it).

### Vault file storage & previews (optional — Vault features degrade gracefully without them)
| Variable | Notes |
|---|---|
| `R2_ENDPOINT` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` | Cloudflare R2 (S3-compatible). All four needed for file upload/download. `R2_ENDPOINT` must be a full `https://` URL. Verify with `node scripts/verify-r2.js`. |
| `R2_PRESIGN_TTL_SECONDS` | Presigned-URL lifetime, default `300`. |
| `GOTENBERG_URL` | Base URL of the Gotenberg service (see below). Without it, PDF/image previews still work; Office-doc conversions land at `previewStatus = FAILED` rather than hanging. |
| `GOTENBERG_TIMEOUT_MS` | Per-conversion timeout, default `60000`. |

> **Gotenberg is a SEPARATE Railway service**, not part of the API image —
> see [`deploy/gotenberg/README.md`](deploy/gotenberg/README.md) for its
> one-time setup. Deploy it, then set `GOTENBERG_URL` on the backend to its
> URL. The API only POSTs documents to it over HTTP; it bundles no LibreOffice.

### Transactional email (optional — the app boots and runs without it)
| Variable | Notes |
|---|---|
| `RESEND_API_KEY` | Resend API key (`re_…`). **Environment variable only** — never in code, a config file, or a commit. Without it, `EmailService` logs a warning at boot and any send throws `Email sending is not configured (set RESEND_API_KEY, EMAIL_FROM)`. |
| `EMAIL_FROM` | Sender, e.g. `tx-peoplehub <no-reply@phaze-dynamics.com>` or a bare address. **Must be on a domain verified in Resend** (SPF + DKIM below), otherwise every send is rejected. Validated at boot. |
| `EMAIL_REPLY_TO` | Optional default `Reply-To` (a real monitored inbox — `no-reply` senders get replies anyway). Individual messages can override it. |
| `EMAIL_ALLOWED_RECIPIENTS` | Staging safety net: comma-separated addresses and/or domains (`ops@acme.com, @acme.com`). Recipients outside the list are dropped with a warning instead of being mailed. **Leave empty in production.** |
| `EMAIL_DRY_RUN` | `true` logs each email instead of delivering it (local dev / CI). |

**Sending-domain DNS (one-time, needs access to the domain's DNS zone).**
Same category of step as the `phazeone.phaze-dynamics.com` subdomain setup:

1. Resend → **Domains → Add Domain**, enter the sending domain.
2. Copy the records Resend shows — typically a `TXT` SPF record on `send`, a
   `TXT` DKIM record on `resend._domainkey`, and an `MX` record on `send` — into
   the DNS zone **exactly** as given.
3. Press **Verify** in Resend. Propagation can take up to an hour.
4. Confirm from your laptop — this is the check that proves the records are
   verified, not merely added:
   ```
    RESEND_API_KEY="re_…" EMAIL_FROM="tx-peoplehub <no-reply@your-domain>" \
      EMAIL_TEST_TO="you@your-company.com" node scripts/verify-email.js
   ```
   It fails loudly on any record still `pending`/`failed`, then sends one real
   test email. Add `--no-send` for the key + DNS checks only.
5. Confirm the **deployed** service has the same wiring (a laptop run can't
   prove Railway's env): as a SUPER_ADMIN, `GET /health/email` returns the
   sender, dry-run/allowlist state, and each domain record's status, and
   `POST /health/email-test` with `{"to":"you@your-company.com"}` sends through
   the shared `EmailService`. Neither route ever returns the API key.

**What sends email today.** Nothing sends automatically — every email is a
deliberate staff action, so an un-configured key can never silently break a
business flow:

| Feature | Trigger | Route |
|---|---|---|
| Vendor qualification invite | "Email to vendor" on the vendor detail page | `POST /vendors/invites/:inviteId/email` |
| Supplier qualification invite | "Email to supplier" on the supplier detail page | `POST /suppliers/invites/:inviteId/email` |
| RFQ quote link | "Email"/"Email all invitees" on the RFQ detail page (ISSUED/CLOSED) | `POST /rfqs/:id/invitees/email` |
| PLM vendor update link | "Email" on a vendor update link, in the PLM block of the order detail page | `POST /plm/vendor-invites/:id/email` |

All of them send the *existing* invite link (so re-sending never invalidates a
link the partner already has), refuse a revoked or expired invite, default the
recipient to the company's contact email, and **never** include the invite
password — share that separately. `FRONTEND_ORIGIN` must be correct: the emailed
link is built from it.

The PLM one differs from the other invites in what it asks for: it is a *standing*
channel, not a one-shot form. The email states the agreed update cadence ("we ask
for an update every 7 days"), that the same link works for every update, and that
confirmed production steps cannot be undone (the server refuses a step count below
the furthest already confirmed, so a vendor who is not told hits an error instead
of reading a rule). It names the product by **our** catalogue name — the customer's
own PO wording is deliberately not even queried, so it cannot leak to a vendor.
Emailing a link does **not** write a tracker timeline event, matching the vendor
and supplier invite routes; the timeline records only created and revoked.

The RFQ route mails a batch (an RFQ has three or more invitees) and reports per
invitee — `{ sent, skipped, failed, results[] }` — so one partner without a
contact email or one provider rejection never stops the rest. It skips invitees
whose link cannot work (revoked, not yet issued, RFQ closed, deadline passed) and,
on a blanket send, those who already submitted or declined; naming
`inviteeIds` mails them anyway. An invitee whose revision window is open gets the
revision-request wording and their revision deadline instead.

> Everything goes through `EmailService` (`src/core/email/`): `send()` throws so
> a user-triggered send surfaces its failure, `trySend()` logs and returns
> `null` so a background notification can never roll back a business action.

> `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` are only read by the seed script,
> which you run **from your laptop** (see below) — they are **not** needed as
> Railway service vars.

### Web Push notifications (optional — the app boots and runs without it)

**This is not email.** Push uses the Web Push API with VAPID keys, delivered by
Apple/Google/Mozilla's own push services. It shares no key, no library, no
table and no code path with Resend — turning one on or off has no effect on the
other. Both channels exist independently.

| Variable | Notes |
|---|---|
| `VAPID_PUBLIC_KEY` | The public half of the keypair. Handed to browsers by `GET /push/config`, so it is not a secret — but it must match the private key exactly. |
| `VAPID_PRIVATE_KEY` | **Environment variable only** — never in code, a config file, or a commit (same discipline as `RESEND_API_KEY`). Without the three vars, `PushNotificationService` warns at boot and any send throws `Push notifications are not configured (set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT)`. |
| `VAPID_SUBJECT` | Contact for this app's pushes, required by the push services. `mailto:info@phaze-dynamics.com` or an `https://` URL. Validated at boot. |

**Generate the keypair once, then keep it forever:**

```
 node -e "console.log(require('web-push').generateVAPIDKeys())"
```

Paste the two values into Railway. **Rotating the keypair silently invalidates
every device subscription already stored** — every user would have to tap "Turn
on notifications" again — so treat it as permanent, not as a rotatable secret.
Staging and production may safely use different keypairs; a subscription is
per-origin anyway.

**Confirm the deployed service.** As a SUPER_ADMIN, `GET /health/push` returns
`{ configured, publicKey, subject, devices, employeesWithDevices }` — never the
private key. There is deliberately **no** `POST /health/push-test`: a push can
only be proven by the phone it lands on, so the test send lives on the profile
page, where the person holding the device presses it (`POST /push/test`).

**A 200 is not a delivered notification.** `POST /push/test` returns
`{ delivered, expired, failed, skipped? }`; the UI treats `delivered === 0` as a
failure, and even a non-zero `delivered` only means a push service *accepted*
the message. As with the email verification, the real check is the device.

**What sends a push today.** Eight kinds of event, plus the user's own test
button. Each hooks the trigger point that already existed for the equivalent
in-app surface, so the two channels cannot disagree about whether something
happened — with one documented exception, the PLM cadence sweep, below.

| Event | Content | Tapping it opens |
|---|---|---|
| A Ping you received | Sender's name + a preview of the message | `/my-pings` |
| A Kanban card assigned/reassigned to you | Assigner's name + the task title | `/kanban/cards/:id` (the existing resolver: board + card modal for a board member, standalone card view for a non-member assignee) |
| A comment on a Kanban card **you created** | Commenter's name, the card title + a preview of the comment | `/kanban/cards/:id` |
| An approval waiting on you — one of **seven** gates: offer letter, candidate requisition, BOM release, RFQ PM approval, ad-hoc PO, ECR (design change), expense claim | Which gate, the record's own reference, and who asked | That record's page (see *Deep links* below) |
| A vendor submitted **or revised** a quote on your RFQ | Vendor name + RFQ number; a revision is called out as such | `/scm/rfqs/:id` |
| A vendor has gone past your PLM tracker's agreed update cadence | Vendor name, order number, product, and the cadence they are missing | `/plm/trackers/:id` |
| A design review on your project was recorded **REJECTED** | Project name + review type | `/design/projects?focus=:id` |
| Your order cleared **final QC**, or a challan for it was **dispatched** | Order number + what is shipping (a product name, or "3 products"); dispatch also names the DC | `/sales/orders/:id` / `/logistics/dispatch/:id` |

Only REJECTED design reviews push — APPROVED is good news and
APPROVED_WITH_CONDITIONS is carried by the review's action items. Only final QC
and dispatch push out of the whole PLM/order ladder: they are the points where
something becomes *possible*, not one more stage advancing.

**Comments push to the card's creator only** — not to its assignee, and not to
board members. The assignee is already working the card and will see the thread;
the person who raised it has no other reason to look, which is what makes their
case worth a phone buzz and the assignee's not. Both still get the in-app
`CARD_COMMENTED` row (the creator's is new — before this, a comment notified the
assignee and nobody else, so raising a card and handing it over meant hearing
nothing about it). The tag is keyed to the **card**, so a ten-comment
back-and-forth is one standing notification, not ten buzzes.

Deliberately **not** pushed: Kanban card edits and moves, comments on a card you
merely watch or are assigned, routine PLM/order status changes short of dispatch,
on-time vendor production updates, GRN and inventory movement, Vault uploads,
efficiency-score and analytics changes. Those stay in-app. Pings was built around
not over-notifying, and a channel that buzzes a phone has to be held to a higher
bar than an in-app badge. The complete list lives in one file —
`src/modules/notifications/push-triggers.ts` — so adding a ninth means editing it
there.

**Nobody is ever notified about their own action.** That rule is enforced once,
in `PushEventsService.resolve()`, which drops the actor from the recipient set —
it matters most on the gates that can legitimately be self-approved (a SuperAdmin
raising an ad-hoc PO, a Project Manager creating an RFQ).

Every one is fire-and-forget: the push is dispatched without being awaited, so no
business action ever waits on Apple's or Google's servers, and a recipient with no
subscribed device is a silent no-op rather than an error. `PushEventsService`
additionally wraps its *lookups* in the same guarantee, so a deleted row or a
Prisma blip cannot fail the action that triggered the notification.

**Deep links.** Five of the seven approval gates open the record's own detail
route (`/hr/offer-letters/pending-approval/:id`, `/scm/bom/:id`, `/scm/rfqs/:id`,
`/stores/purchase-orders/:id`, `/design/changes/:id`, `/expense-claims/:id`).
Candidate requisitions and design projects have **no route of their own**, so
they use `?focus=<id>` on their list page — the same convention as the existing
`profile?tab=org-chart&focus=`. On `/hr/candidate-requisitions` that opens the
requisition's details dialog; on `/design/projects` it scrolls to and highlights
the row. Both fire once per id, so closing the dialog or scrolling away does not
spring back on the next refresh.

**One event is swept, not triggered — by necessity.** A PLM vendor cadence breach
is not an action anyone takes: `deriveVendorCadence()` is a pure function of (last
update, cadence days, now), evaluated when a screen is read, and the RED state
arrives simply by the clock moving. There is no write, no request and no actor at
the moment it happens, so there is nothing to hook.
`PlmVendorCadenceSweepService` therefore runs `@Cron('0 9 * * *', { timeZone:
'Asia/Kolkata' })` — 09:00 IST, when chasing a vendor is something the owner can
actually do — reusing the *same* `deriveVendorCadence` and the same reference-date
fallback chain as `PlmService.withDerived`, so a tracker that shows red on the PLM
board is exactly the one that pushes. This mirrors
`QmsService.notifyOverdueActions()`, which exists for the same reason. It re-sends
each morning while the breach lasts; the `tag` is keyed to the tracker, so each
morning **replaces** the standing notification rather than stacking another. AMBER
("due soon") never pushes.

| Route | Purpose |
|---|---|
| `GET /push/config` | Whether push is configured + the public key |
| `GET /push/devices` | The caller's subscribed devices (never endpoints or keys) |
| `POST /push/subscriptions` | Register this browser's subscription |
| `DELETE /push/subscriptions?endpoint=…` / `DELETE /push/subscriptions/:id` | Unsubscribe this browser / remove a listed device |
| `POST /push/test` | Send the caller a test notification |

Every one is self-scoped — a user can only ever see and change their own
devices, so none of them carries a role restriction.

> Everything goes through `PushNotificationService` (`src/core/push/`), mirroring
> the email service's pairing: `sendToEmployee()` throws so a user-triggered send
> surfaces its failure, `trySendToEmployee()` logs and returns `null` so a
> background notification can never roll back a business action. A subscription
> the push service reports as gone (404/410) is deleted on the spot.

**iOS is stricter than Android, and not optionally so.** On iPhone/iPad, push
works *only* after the app has been added to the home screen and opened from
there — a regular Safari tab cannot receive one at all. That is why the manifest
declares `display: "standalone"` and why the install banner tells iOS users to
use **Share → Add to Home Screen** (there is no `beforeinstallprompt` on iOS to
do it for them). The permission prompt also has to come from a real tap, which is
why it lives behind the profile page's button and never fires on page load.

---

## Frontend environment variables (Vercel)

Exactly two:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | The Railway backend's public URL (protocol + domain, no trailing slash). |
| `NEXT_PUBLIC_PAYSLIPS_ENABLED` | `false` — keep the employee payslip screen gated until payroll rates have compliance sign-off. |

---

## Migrations & seed

**Migrations run automatically** on every deploy: the container `CMD` (in the
`Dockerfile`) runs `prisma migrate deploy` and then `node dist/main.js`. The
start command lives **only** in the Dockerfile — `railway.json` deliberately
has **no** `startCommand`, because Railway's `startCommand` overrides the image
`CMD` and would silently mask any Dockerfile change. `migrate deploy` (never
`migrate dev`) applies committed migrations against the target DB. `prisma` is
a production dependency, so the CLI is present in the runtime image — the CMD
calls the local `./node_modules/.bin/prisma` binary directly (not via `npx`,
which can hang on an external registry call in Railway's restricted network).

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

- [ ] SuperAdmin login works end-to-end (exercises CORS + the refresh cookie).
- [ ] HR onboarding: create employee → grant access → new employee logs in.
- [ ] Encrypted fields are actually ciphertext in the staging DB (don't assume `ENCRYPTION_KEY` was picked up just because the deploy succeeded — inspect a row).
- [ ] Leave: request → approval → balance deduction.
- [ ] Cross-vertical onboarding (HR onboards someone into Sales) works in staging, not just locally.
- [ ] Payroll employee-facing payslip route stays gated (`NEXT_PUBLIC_PAYSLIPS_ENABLED=false`).
- [ ] Refresh-token flow: log in, let the access token expire (or force it), confirm silent refresh rather than a forced re-login. (This is the real refresh-cookie test — run it in **desktop Chrome and on a real iPhone**. Chrome will pass even with a cross-domain API; Safari only passes once the API is on the same registrable domain as the frontend. See the same-domain section above.)
- [ ] Sales pipeline: Lead → Opportunity → Bid → Order.
- [ ] Bid/No-Bid gate: `POST /bids` blocked with no assessment → submit → reject w/ comment (as Sales Head) → still blocked → resubmit → approve → bid creation now succeeds.
- [ ] The 8 seeded assessment questions actually appear in the submit form (verify the seed ran against staging, don't assume).
- [ ] Sales-vertical-wide read visibility: a Sales `EMPLOYEE` can view a **peer's** bid/lead/opportunity/order (reads are vertical-wide; writes stay owner/hierarchy-scoped). Tell testers to expect this.
- [ ] **PLM vendor update link email** (needs `EMAIL_DRY_RUN` unset and the recipient inside `EMAIL_ALLOWED_RECIPIENTS`, if that list is set): on a VENDOR tracker, create an update link → press **Email** → the mail **arrives in a real inbox**, its button opens the public update form, and the form accepts a step confirmation. A green toast is not the test; a toast reading "Email not sent" means the send was dry-run or allowlist-suppressed, not delivered.

### Installable app + push notifications (needs two real phones, not a desktop emulator)

- [ ] **Android/Chrome:** the install banner offers a native **Install** button (`beforeinstallprompt`) and installing works.
- [ ] **iOS/Safari:** no native button appears — the banner shows the **Share → Add to Home Screen** instructions instead.
- [ ] Launching from the home-screen icon on both platforms opens **standalone**: app icon, no address bar, no browser tabs.
- [ ] The install banner **never reappears** once the app is opened from the home screen (on either platform).
- [ ] Profile → Notifications → **Turn on notifications** subscribes on both platforms, and the permission dialog only ever appears after that tap — never on page load.
- [ ] **Send a test notification** and see it **arrive on the phone**. A green toast is not the test; the phone is. Confirm the device also appears under "Your devices".
- [ ] From a second account, **send the phone's owner a Ping** — the push shows the sender's name and a preview, and tapping it opens `/my-pings`.
- [ ] From a second account, **assign the phone's owner a Kanban card** — the push shows the assigner's name and the task title, and tapping it opens that card (board modal if they're a board member, standalone card view if not).
- [ ] **An approval reaches the right phone.** Submit an **expense claim** as someone else and confirm the Accounts Head's (or SuperAdmin's) phone buzzes with the claim number and the claimant's name, and that tapping it opens `/expense-claims/:id`. Then spot-check one gate with no detail route — raise a **candidate requisition** and confirm the approver's tap opens `/hr/candidate-requisitions?focus=…` *with the details dialog already open*, and that closing it and pulling to refresh does **not** reopen it.
- [ ] **Self-approval sends nothing.** As a SuperAdmin, raise an **ad-hoc PO** yourself: the queue badge updates and **no push arrives on your own phone**.
- [ ] **A vendor quote reaches the RFQ owner.** Submit a quote through a vendor's token link and confirm the RFQ creator's phone shows the vendor's name + RFQ number, opening `/scm/rfqs/:id`. If the RFQ has a revision window open, submit a revision too — the copy must read "revised their quote", and it should **replace** the earlier notification rather than stack.
- [ ] **Dispatch.** Clear **final QC** on an order and confirm the order owner gets "Ready to dispatch — ORD-…" naming the product (or "N products"); then **dispatch a challan** and confirm a second push opens `/logistics/dispatch/:id`. Retry the QC clearance from a stale tab: it succeeds idempotently and sends **no second push**.
- [ ] **Design review rejection.** Record a review outcome as **REJECTED** and confirm the project's lead designer gets it, landing on `/design/projects?focus=…` with the row scrolled into view and highlighted. Record an **APPROVED** outcome: **no push**.
- [ ] **Vendor cadence (needs the clock, or a manual call).** This one is swept at 09:00 IST rather than triggered, so either wait a morning with a vendor tracker past its cadence, or invoke `notifyVendorCadenceBreaches()` directly. Confirm the tracker **owner** gets the vendor + order + product, that an AMBER ("due soon") tracker sends nothing, and that a second sweep the next day **replaces** rather than stacks.
- [ ] **A comment on a card they created.** From a second account, comment on a card the phone's owner **created but assigned to someone else** — their phone shows the commenter's name, the card title and a preview of the comment, and tapping it opens the card. Confirm the **assignee gets the in-app bell row but no push**. Then comment again: the notification **replaces** the first rather than stacking a second.
- [ ] **The silence is the scope.** Move a card and edit its fields; comment on a card the phone's owner is merely *assigned* (didn't create); post an on-time vendor production update; advance a PLM stage short of dispatch; upload to Vault; receive a GRN. The in-app bell and badges update, and **no push arrives** for any of them.
- [ ] Turn notifications **off** on the device, then have someone Ping them again, and submit an approval that routes to them: both still send normally with no error for the sender, and no error in the backend logs.
- [ ] In a plain **iOS Safari tab** (not installed), the Notifications card explains that the app must be added to the home screen first — and no subscribe button is offered. This is expected iOS behaviour, not a bug.
- [ ] `GET /health/push` (SUPER_ADMIN) shows `configured: true` and a device count that matches what you just subscribed — and never returns the private key.

---

## Known fragilities already addressed in the repo

- **Prisma CLI in the runtime image** — `prisma` was moved from `devDependencies` to `dependencies`, so in-container `migrate deploy` uses the bundled CLI instead of downloading it on every boot.
- **Seed can't run in-container** — dev deps are stripped from the runtime image, so the seed runs from your laptop (documented above). This is intentional, not a bug.
- **Prisma CLI hang on boot** — in Railway's restricted-network container the migrate step could hang before the app started, blocking boot until the healthcheck timed out. The suspected culprit was an external network call (`npx`'s registry resolution, and/or Prisma telemetry). Addressed defensively at the image level: the `Dockerfile` calls the local `prisma` binary directly instead of via `npx`, wraps it in `timeout 30` so any residual hang fails fast with a clear log, echoes each boot step, and sets `ENV CHECKPOINT_DISABLE=1` + `ENV DO_NOT_TRACK=1` (telemetry opt-outs). All baked into the image, so **every** environment (staging, a future production Railway service, CI image builds) inherits it — do **not** re-add these as per-environment Railway env vars, and do **not** add a `startCommand` to `railway.json` (it would override the image `CMD` and mask all of this).

## Not included (flag if you want them)

- CI/CD auto-deploy on push (GitHub Actions → Railway/Vercel) — currently manual/on-demand.
- Error tracking (Sentry) — worth it once real bug reports start.

Note that a **custom domain is no longer in this list**: the API and the frontend
sharing one registrable domain is a requirement, not a polish item, because
sign-in persistence on iOS depends on it. See the same-domain section above.

## Announce to testers

- This is a **non-persistent test environment** — data may be wiped; don't treat entries as durable.
- Use **your own login**, but **synthetic** PAN/Aadhaar/bank values.
- State a **feedback channel** for bug reports.
- Be clear on **what's testable now vs. coming soon** (e.g. if Sales lands in a later deploy).
- Expect a **more polished UI** (shadcn/Tailwind pass) than earlier walkthroughs; a not-yet-restyled corner isn't "broken."
