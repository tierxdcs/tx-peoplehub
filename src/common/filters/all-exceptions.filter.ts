import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Global exception filter — normalizes every error into a consistent JSON
 * envelope so the frontend and API consumers get a predictable shape.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let message: string | object = 'Internal server error';
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      message = typeof res === 'string' ? res : ((res as any).message ?? res);
    }

    // Strip the query string before it is ever logged or returned — a request
    // must never leak a secret it carried in the URL (e.g. a share-link
    // password) into server logs, error trackers, or the response body.
    const path = request.url.split('?')[0];

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${path}`,
        (exception as Error)?.stack,
      );
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      path,
      timestamp: new Date().toISOString(),
      message,
    });
  }
}
