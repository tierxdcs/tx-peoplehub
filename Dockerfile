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
# than depending on a per-environment env var being set).
ENV CHECKPOINT_DISABLE=1

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
# Run migrations on release, then start. `set -e` makes a non-zero exit from
# migrate deploy abort the boot loudly instead of being masked; the echo makes
# the migrate→start handoff explicit in the deploy logs (so "migrations ran but
# app never logged" is unambiguous rather than silent).
CMD ["sh", "-c", "set -e; npx prisma migrate deploy; echo 'Migrations complete — starting app'; node dist/main.js"]
