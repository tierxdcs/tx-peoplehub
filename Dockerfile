# ── Build stage ─────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

# ── Runtime stage ───────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# `prisma migrate deploy` finishes its work but the CLI then hangs on a
# background telemetry/checkpoint network call that never completes in a
# restricted-network container — so the chained `node dist/main.js` never runs
# and the health check times out. Disabling the checkpoint call lets the CLI
# exit cleanly. Baked into the image so every environment inherits it (rather
# than depending on a per-environment env var being set). DO_NOT_TRACK is the
# cross-tool telemetry opt-out standard — set defensively alongside it.
ENV CHECKPOINT_DISABLE=1
ENV DO_NOT_TRACK=1

# Alpine ships without timezone data. The leave-accrual @Cron job pins a
# named zone (Asia/Kolkata) and the app does IST calendar-day math — both
# need the IANA tz database present, or named-zone resolution can throw /
# misbehave at runtime. Cheap insurance against a tz-related boot failure.
RUN apk add --no-cache tzdata

COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000
# Run migrations on release, then start. Notes on each piece:
#  - `set -e`: a non-zero exit from the migrate step aborts the boot loudly
#    instead of being masked.
#  - Call the local prisma binary directly instead of `npx prisma`: `npx` can
#    make an external npm-registry call to resolve the package before running
#    it, which hangs in Railway's restricted-network container (internal
#    postgres traffic works, external calls don't). prisma is a production
#    dependency, so the binary is already in node_modules — no resolution
#    needed.
#  - `timeout 30`: safety net. If the migrate step still hangs, BusyBox timeout
#    kills it (exit 143), `set -e` catches the non-zero, and the container
#    fails fast with a clear signal instead of silently burning the whole
#    healthcheck window.
#  - per-step echoes with $?: make exactly where boot stopped visible in the
#    deploy logs, so a future hang needs no extra debugging round-trip.
# NOTE: this CMD is the single source of truth for the start command. Do not
# re-add a `startCommand` to railway.json — Railway's startCommand overrides
# the image CMD, which previously masked every change made here.
CMD ["sh", "-c", "set -e; echo 'Starting migration...'; timeout 30 ./node_modules/.bin/prisma migrate deploy; echo \"Migration exited with code $?\"; echo 'Starting app...'; node dist/main.js"]
