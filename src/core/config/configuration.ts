/**
 * Typed configuration namespaces, loaded from validated env vars.
 * Access via ConfigService, e.g. `config.get('jwt.accessSecret')`.
 */
export default () => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:3001',
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET as string,
    accessTtl: process.env.JWT_ACCESS_TTL ?? '900s',
    refreshSecret: process.env.JWT_REFRESH_SECRET as string,
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '7d',
    refreshCookieName: process.env.REFRESH_COOKIE_NAME ?? 'peoplehub_rt',
  },
});
