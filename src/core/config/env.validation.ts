import * as Joi from 'joi';

/**
 * Validation schema for process environment. Fails fast on boot if the
 * environment is misconfigured (12-factor: config lives in the environment).
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().default(3000),
  FRONTEND_ORIGIN: Joi.string().uri().default('http://localhost:3001'),
  // IANA timezone name used for "what calendar day is it" logic (leave
  // date validation, attendance check-in day boundaries).
  TIMEZONE: Joi.string().default('Asia/Kolkata'),

  DATABASE_URL: Joi.string().required(),

  JWT_ACCESS_SECRET: Joi.string().required(),
  JWT_ACCESS_TTL: Joi.string().default('900s'),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_REFRESH_TTL: Joi.string().default('7d'),
  REFRESH_COOKIE_NAME: Joi.string().default('peoplehub_rt'),

  // Base64-encoded 32-byte key for AES-256-GCM encryption of PII columns
  // (PAN, PF/ESIC numbers, bank account numbers). Generate with:
  // `openssl rand -base64 32`.
  ENCRYPTION_KEY: Joi.string()
    .required()
    .custom((value: string, helpers) => {
      let decoded: Buffer;
      try {
        decoded = Buffer.from(value, 'base64');
      } catch {
        return helpers.error('any.invalid');
      }
      if (decoded.length !== 32) {
        return helpers.error('any.invalid');
      }
      return value;
    }, 'base64-encoded 32-byte key'),

  SEED_ADMIN_EMAIL: Joi.string()
    .email({ tlds: { allow: false } })
    .optional(),
  SEED_ADMIN_PASSWORD: Joi.string().optional(),

  // ── Vault file storage (Cloudflare R2, S3-compatible) ──────────────
  // Optional so the app still boots in dev/CI without object storage —
  // VaultStorageService throws a clear error only when a file operation is
  // actually attempted without these set (see the service). All five are
  // needed together for uploads/downloads to work.
  R2_ENDPOINT: Joi.string().uri().optional(),
  R2_REGION: Joi.string().default('auto'),
  R2_ACCESS_KEY_ID: Joi.string().optional(),
  R2_SECRET_ACCESS_KEY: Joi.string().optional(),
  R2_BUCKET: Joi.string().optional(),
  // Presigned URL lifetime in seconds — short-lived by design (minutes).
  R2_PRESIGN_TTL_SECONDS: Joi.number().default(300),

  // ── Vault preview conversion (Gotenberg, separate Railway service) ──
  // Optional: without it, Office-doc conversions fail gracefully
  // (previewStatus → FAILED) and native previews (PDF/image) still work.
  // Base URL of the Gotenberg service, e.g. https://gotenberg.up.railway.app
  GOTENBERG_URL: Joi.string().uri().optional(),
  // Per-conversion timeout in ms (Office → PDF can be slow for large docs).
  GOTENBERG_TIMEOUT_MS: Joi.number().default(60000),
  GST_GATEWAY_URL: Joi.string().uri().optional(),
  GST_GATEWAY_TOKEN: Joi.string().optional(),
});
