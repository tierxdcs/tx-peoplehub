import {
  INestApplication,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * PrismaService wraps the generated PrismaClient and ties its lifecycle to
 * the Nest application. Inject it in any service to access the database.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    await this.$connect();
  }

  /**
   * Release the connection pool when the Nest module is torn down (e.g.
   * `app.close()`). Without this, each closed app leaks its pool — harmless in
   * production (one long-lived app) but fatal to the e2e suite, where 20+
   * suites each boot and close an app serially and would otherwise exhaust
   * Postgres `max_connections`.
   */
  async onModuleDestroy() {
    await this.$disconnect();
  }

  /** Close Prisma cleanly when the Nest app receives a shutdown signal. */
  async enableShutdownHooks(app: INestApplication) {
    process.on('beforeExit', async () => {
      await app.close();
    });
  }
}
