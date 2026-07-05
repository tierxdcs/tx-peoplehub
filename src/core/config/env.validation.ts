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
});
