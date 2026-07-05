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

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
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
    const rawRouteId = request.params?.id;
    const routeId =
      (method === 'PATCH' || method === 'PUT') && typeof rawRouteId === 'string'
        ? rawRouteId
        : undefined;

    const beforePromise = routeId
      ? this.fetchBefore(entity, routeId)
      : Promise.resolve(undefined);

    return next.handle().pipe(
      tap((result) => {
        void beforePromise.then((before) =>
          this.write({
            actorId: user?.id,
            action,
            entity,
            entityId: this.deriveEntityId(result) ?? routeId,
            before,
            after: body,
            ip,
          }),
        );
      }),
    );
  }

  /** Best-effort fetch of the current row before it's mutated, for the audit diff. */
  private async fetchBefore(
    entity: string | undefined,
    id: string,
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
      const row = await model.findUnique({ where: { id } });
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

  /** Best-effort entity name from the first path segment, e.g. /users -> User. */
  private deriveEntity(url: string): string | undefined {
    const segment = url.split('?')[0].split('/').filter(Boolean)[0];
    if (!segment) {
      return undefined;
    }
    const singular = segment.endsWith('s') ? segment.slice(0, -1) : segment;
    return singular.charAt(0).toUpperCase() + singular.slice(1);
  }

  private deriveEntityId(result: unknown): string | undefined {
    if (result && typeof result === 'object' && 'id' in (result as object)) {
      const id = (result as { id: unknown }).id;
      return typeof id === 'string' ? id : undefined;
    }
    return undefined;
  }
}
