import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
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
import { EncryptionModule } from './core/crypto/encryption.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { AuthModule } from './modules/auth/auth.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { VerticalsModule } from './modules/verticals/verticals.module';
import { LeaveModule } from './modules/leave/leave.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    EncryptionModule,
    AuthModule,
    EmployeesModule,
    VerticalsModule,
    LeaveModule,
    AttendanceModule,
    PayrollModule,
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
