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

  DATABASE_URL: Joi.string().required(),

  JWT_ACCESS_SECRET: Joi.string().required(),
  JWT_ACCESS_TTL: Joi.string().default('900s'),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_REFRESH_TTL: Joi.string().default('7d'),
  REFRESH_COOKIE_NAME: Joi.string().default('peoplehub_rt'),

  SEED_ADMIN_EMAIL: Joi.string()
    .email({ tlds: { allow: false } })
    .optional(),
  SEED_ADMIN_PASSWORD: Joi.string().optional(),
});
