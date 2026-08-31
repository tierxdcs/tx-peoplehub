import { parseAllowlist } from '../email/email-content';

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
    bucket: process.env.R2_BUCKET,
    presignTtlSeconds: parseInt(
      process.env.R2_PRESIGN_TTL_SECONDS ?? '300',
      10,
    ),
  },
  gotenberg: {
    url: process.env.GOTENBERG_URL,
    timeoutMs: parseInt(process.env.GOTENBERG_TIMEOUT_MS ?? '60000', 10),
  },
  gst: {
    gatewayUrl: process.env.GST_GATEWAY_URL,
    gatewayToken: process.env.GST_GATEWAY_TOKEN,
  },
  // Web Push (VAPID). A second, entirely independent notification channel:
  // different protocol, different library (web-push), different keys, no Resend
  // involvement anywhere in this path. The private key is read from the
  // environment only — same discipline as RESEND_API_KEY and ENCRYPTION_KEY.
  push: {
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
    subject: process.env.VAPID_SUBJECT,
  },
  // Transactional email (Resend). The API key is read from the environment
  // only — never committed, never a fallback literal.
  email: {
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM,
    replyTo: process.env.EMAIL_REPLY_TO,
    allowedRecipients: parseAllowlist(process.env.EMAIL_ALLOWED_RECIPIENTS),
    dryRun: (process.env.EMAIL_DRY_RUN ?? '').toLowerCase() === 'true',
  },
});
