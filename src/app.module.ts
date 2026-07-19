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
import { MustChangePasswordGuard } from './common/guards/must-change-password.guard';
import { AuthModule } from './modules/auth/auth.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { VerticalsModule } from './modules/verticals/verticals.module';
import { LeaveModule } from './modules/leave/leave.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { SalesModule } from './modules/sales/sales.module';
import { VaultModule } from './modules/vault/vault.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { KanbanModule } from './modules/kanban/kanban.module';
import { ProjectKickoffModule } from './modules/project-kickoff/project-kickoff.module';
import { ScmModule } from './modules/scm/scm.module';
import { ScmSupplierModule } from './modules/scm-supplier/scm-supplier.module';
import { BomModule } from './modules/bom/bom.module';
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
    SalesModule,
    VaultModule,
    NotificationsModule,
    KanbanModule,
    ProjectKickoffModule,
    ScmModule,
    ScmSupplierModule,
    BomModule,
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
    // Blocks all routes (except @Public / @AllowDuringForcedReset) while the
    // user's mustChangePassword flag is set. Registered AFTER JwtAuthGuard so
    // request.user is populated when it runs.
    { provide: APP_GUARD, useClass: MustChangePasswordGuard },
  ],
})
export class AppModule {}
