import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  APP_FILTER,
  APP_GUARD,
  APP_INTERCEPTOR,
  Reflector,
} from '@nestjs/core';
import configuration from './core/config/configuration';
import { envValidationSchema } from './core/config/env.validation';
import { PrismaModule } from './core/database/prisma.module';
import { PrismaService } from './core/database/prisma.service';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { AuthModule } from './modules/auth/auth.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { VerticalsModule } from './modules/verticals/verticals.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
    }),
    PrismaModule,
    AuthModule,
    EmployeesModule,
    VerticalsModule,
    HealthModule,
  ],
  providers: [
    // Global exception envelope.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Success response envelope. Registered first so it runs outermost.
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    // Audit trail for mutating requests.
    {
      provide: APP_INTERCEPTOR,
      inject: [PrismaService, Reflector],
      useFactory: (prisma: PrismaService, reflector: Reflector) =>
        new AuditInterceptor(prisma, reflector),
    },
    // Global JWT auth (opt out with @Public()).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
