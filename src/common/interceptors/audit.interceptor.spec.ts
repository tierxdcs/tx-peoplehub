import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { PrismaService } from '../../core/database/prisma.service';
import { AuditInterceptor } from './audit.interceptor';

function makeContext(overrides: {
  method: string;
  url: string;
  params?: Record<string, string>;
  body?: unknown;
  user?: { id: string };
}): ExecutionContext {
  const request = {
    method: overrides.method,
    url: overrides.url,
    route: { path: overrides.url },
    params: overrides.params ?? {},
    body: overrides.body ?? {},
    ip: '127.0.0.1',
    user: overrides.user,
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('AuditInterceptor', () => {
  let prisma: any;
  let reflector: Reflector;
  let interceptor: AuditInterceptor;
  let callOrder: string[];

  beforeEach(() => {
    callOrder = [];
    prisma = {
      attendance: {
        // findUnique (the "before" fetch) resolves asynchronously — if the
        // interceptor doesn't actually await it ahead of next.handle(), the
        // handler's own write can log its call before this resolves.
        findUnique: jest.fn().mockImplementation(async () => {
          callOrder.push('before-fetch:start');
          await new Promise((resolve) => setTimeout(resolve, 20));
          callOrder.push('before-fetch:resolved');
          return {
            id: 'att-1',
            employeeId: 'emp-1',
            date: new Date('2026-07-01T00:00:00.000Z'),
            checkInTime: new Date('2026-07-01T09:00:00.000Z'),
            checkOutTime: new Date('2026-07-01T18:00:00.000Z'),
          };
        }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) } as any;
    interceptor = new AuditInterceptor(prisma as PrismaService, reflector);
  });

  /**
   * Regression test for the race where the before-fetch and the route
   * handler's own mutation were kicked off without ordering between them:
   * an unawaited before-fetch could still be in flight when the handler's
   * write (and any read of the row it just wrote) already ran, so `before`
   * could resolve to post-mutation state. This proves the before-fetch
   * fully completes — including logging its own resolution — before the
   * handler (next.handle()) is ever invoked.
   */
  it('awaits the before-fetch to completion before invoking the route handler', async () => {
    const context = makeContext({
      method: 'PATCH',
      url: '/attendance/emp-1/2026-07-01',
      params: { employeeId: 'emp-1', date: '2026-07-01' },
      body: { checkInTime: '2026-07-01T09:15:00.000Z' },
      user: { id: 'admin-1' },
    });

    const next: CallHandler = {
      handle: jest.fn(() => {
        callOrder.push('handler:invoked');
        return of({
          id: 'att-1',
          employeeId: 'emp-1',
          date: '2026-07-01T00:00:00.000Z',
          checkInTime: '2026-07-01T09:15:00.000Z',
          checkOutTime: '2026-07-01T18:00:00.000Z',
        });
      }),
    };

    const result = interceptor.intercept(context, next);
    // Per NestInterceptor's contract, intercept() may return a
    // Promise<Observable<T>> — this only matters if the implementation
    // actually awaits the before-fetch before returning, which is exactly
    // what's under test here.
    const observable = result instanceof Promise ? await result : result;
    await new Promise<void>((resolve) => {
      observable.subscribe({ complete: resolve });
    });

    expect(callOrder).toEqual([
      'before-fetch:start',
      'before-fetch:resolved',
      'handler:invoked',
    ]);
    expect(prisma.attendance.findUnique).toHaveBeenCalledWith({
      where: {
        employeeId_date: { employeeId: 'emp-1', date: new Date('2026-07-01') },
      },
    });
  });

  it('writes the audit row with the true pre-mutation before value, not a race-affected one', async () => {
    const context = makeContext({
      method: 'PATCH',
      url: '/attendance/emp-1/2026-07-01',
      params: { employeeId: 'emp-1', date: '2026-07-01' },
      body: { checkInTime: '2026-07-01T09:15:00.000Z' },
      user: { id: 'admin-1' },
    });

    const next: CallHandler = {
      handle: () =>
        of({
          id: 'att-1',
          employeeId: 'emp-1',
          date: '2026-07-01T00:00:00.000Z',
          checkInTime: '2026-07-01T09:15:00.000Z',
          checkOutTime: '2026-07-01T18:00:00.000Z',
        }),
    };

    const result = interceptor.intercept(context, next);
    const observable = result instanceof Promise ? await result : result;
    await new Promise<void>((resolve) => {
      observable.subscribe({ complete: resolve });
    });
    // The write() call is itself fire-and-forget (best-effort, never blocks
    // the response) — give its internal await a tick to land.
    await new Promise((resolve) => setImmediate(resolve));

    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    const written = prisma.auditLog.create.mock.calls[0][0].data;
    expect(written.before.checkInTime).toEqual(
      new Date('2026-07-01T09:00:00.000Z'),
    );
    expect(written.after).toEqual({ checkInTime: '2026-07-01T09:15:00.000Z' });
  });
});
