import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../core/database/prisma.service';
import { NO_AUDIT_KEY } from '../decorators/no-audit.decorator';
import { AuthenticatedUser } from '../decorators/current-user.decorator';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Records every mutating (POST/PUT/PATCH/DELETE) request into the AuditLog
 * table: who did what, on which route, with the request body as `after`.
 * Opt out per-route with @NoAudit(). Writes are best-effort — an audit
 * failure never breaks the request.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  /**
   * Returning a Promise<Observable<T>> here (NestInterceptor's contract
   * allows it) is what makes the `await this.fetchBefore(...)` below
   * actually happen-before `next.handle()` invokes the route handler.
   * Previously the before-fetch and next.handle() were both kicked off
   * without ordering between them (an unawaited `beforePromise` raced
   * against the handler's own write) — Node's scheduler was then free to
   * let the handler's mutation commit before the before-fetch's SELECT
   * even ran, so `before` could silently read back post-mutation state.
   * That's a real correctness bug (not just test flakiness): two
   * back-to-back PATCHes on the same row could each record an audit row
   * whose `before` equals its own `after`, undetectable without a specific
   * before/after diff assertion. Every PATCH/PUT route audited by this
   * interceptor was equally exposed — both the routeId and compoundWhere
   * branches shared this same race, not just compound-key routes.
   */
  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method?.toUpperCase();

    const noAudit = this.reflector.getAllAndOverride<boolean>(NO_AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (noAudit || !MUTATING_METHODS.has(method)) {
      return next.handle();
    }

    const user = (request as any).user as AuthenticatedUser | undefined;
    const action = `${method} ${request.route?.path ?? request.url}`;
    const entity = this.deriveEntity(request.url);
    const body = this.sanitize(request.body);
    const ip = request.ip;
    const isPatchOrPut = method === 'PATCH' || method === 'PUT';
    const rawRouteId = request.params?.id;
    const routeId =
      isPatchOrPut && typeof rawRouteId === 'string' ? rawRouteId : undefined;

    // Compound-key routes (e.g. PATCH /attendance/:employeeId/:date) have no
    // single :id param — fall back to a per-entity compound-where lookup.
    const compoundWhere = isPatchOrPut
      ? this.deriveCompoundWhere(entity, request.params)
      : undefined;

    const before = routeId
      ? await this.fetchBefore(entity, { id: routeId })
      : compoundWhere
        ? await this.fetchBefore(entity, compoundWhere)
        : undefined;

    const fallbackEntityId =
      routeId ??
      (compoundWhere
        ? `${request.params.employeeId}/${request.params.date}`
        : undefined);

    return next.handle().pipe(
      tap((result) => {
        void this.write({
          actorId: user?.id,
          action,
          entity,
          entityId: this.deriveEntityId(result) ?? fallbackEntityId,
          before,
          after: body,
          ip,
        });
      }),
    );
  }

  /**
   * Route params that identify a row via a compound unique constraint
   * instead of a single :id — e.g. PATCH /attendance/:employeeId/:date
   * maps to Attendance's @@unique([employeeId, date]).  Add an entry here
   * whenever a new entity's PATCH route uses a compound natural key.
   */
  private deriveCompoundWhere(
    entity: string | undefined,
    params: Record<string, string | string[]>,
  ): Record<string, unknown> | undefined {
    const employeeId = params.employeeId;
    const date = params.date;
    if (
      entity === 'Attendance' &&
      typeof employeeId === 'string' &&
      typeof date === 'string'
    ) {
      return {
        employeeId_date: {
          employeeId,
          date: new Date(date),
        },
      };
    }
    return undefined;
  }

  /** Best-effort fetch of the current row before it's mutated, for the audit diff. */
  private async fetchBefore(
    entity: string | undefined,
    where: Record<string, unknown>,
  ): Promise<unknown> {
    if (!entity) {
      return undefined;
    }
    const accessor = entity.charAt(0).toLowerCase() + entity.slice(1);
    const model = (this.prisma as any)[accessor];
    if (!model?.findUnique) {
      return undefined;
    }
    try {
      const row = await model.findUnique({ where });
      return this.sanitize(row);
    } catch (err) {
      this.logger.warn(
        `Failed to fetch pre-mutation state: ${(err as Error).message}`,
      );
      return undefined;
    }
  }

  private async write(data: {
    actorId?: string;
    action: string;
    entity?: string;
    entityId?: string;
    before?: unknown;
    after?: unknown;
    ip?: string;
  }) {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: data.actorId ?? null,
          action: data.action,
          entity: data.entity ?? null,
          entityId: data.entityId ?? null,
          before: (data.before as any) ?? undefined,
          after: (data.after as any) ?? undefined,
          ip: data.ip ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to write audit log: ${(err as Error).message}`);
    }
  }

  /** Strip obviously sensitive fields before persisting the request body. */
  private sanitize(body: unknown): unknown {
    if (!body || typeof body !== 'object') {
      return body;
    }
    const clone: Record<string, unknown> = { ...(body as object) };
    for (const key of Object.keys(clone)) {
      if (/password|secret|token/i.test(key)) {
        clone[key] = '[REDACTED]';
      }
    }
    return clone;
  }

  /**
   * Best-effort entity name from the first path segment, e.g. /users ->
   * User, /leave-requests -> LeaveRequest. Kebab-case segments are
   * PascalCased word-by-word first, then the whole thing is singularized
   * (naive trailing-s strip) — doing it in this order is what makes
   * /leave-requests resolve to the real Prisma accessor `leaveRequest`
   * instead of the malformed `Leave-request`.
   */
  private deriveEntity(url: string): string | undefined {
    const segment = url.split('?')[0].split('/').filter(Boolean)[0];
    if (!segment) {
      return undefined;
    }
    const pascalCase = segment
      .split('-')
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');
    return pascalCase.endsWith('s') ? pascalCase.slice(0, -1) : pascalCase;
  }

  private deriveEntityId(result: unknown): string | undefined {
    if (result && typeof result === 'object' && 'id' in (result as object)) {
      const id = (result as { id: unknown }).id;
      return typeof id === 'string' ? id : undefined;
    }
    return undefined;
  }
}
