/**
 * Typed configuration namespaces, loaded from validated env vars.
 * Access via ConfigService, e.g. `config.get('jwt.accessSecret')`.
 */
export default () => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:3001',
  timezone: process.env.TIMEZONE ?? 'Asia/Kolkata',
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET as string,
    accessTtl: process.env.JWT_ACCESS_TTL ?? '900s',
    refreshSecret: process.env.JWT_REFRESH_SECRET as string,
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '7d',
    refreshCookieName: process.env.REFRESH_COOKIE_NAME ?? 'peoplehub_rt',
  },
  encryptionKey: process.env.ENCRYPTION_KEY as string,
  r2: {
    endpoint: process.env.R2_ENDPOINT,
    region: process.env.R2_REGION ?? 'auto',
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucket: process.env.R2_BUCKET ?? process.env.R2_BUCKET_NAME,
    presignTtlSeconds: parseInt(
      process.env.R2_PRESIGN_TTL_SECONDS ?? '300',
      10,
    ),
  },
  gotenberg: {
    url: process.env.GOTENBERG_URL,
    timeoutMs: parseInt(process.env.GOTENBERG_TIMEOUT_MS ?? '60000', 10),
  },
});
