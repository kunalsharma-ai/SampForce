import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Response } from 'express';
import type { ApiErrorBody } from '@dealflow/types';
import type { AuthedRequest } from './auth-context';
import { localize, pickLanguage } from './request-language';

const CODE_BY_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
};

/** Normalises every error into `{ error: { code, message, requestId, details? } }`. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<AuthedRequest>();
    const requestId = req.id ? String(req.id) : undefined;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ApiErrorBody['error'] = {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again.',
      requestId,
    };

    if (exception instanceof ThrottlerException) {
      status = HttpStatus.TOO_MANY_REQUESTS;
      body = { code: 'RATE_LIMITED', message: 'Too many requests. Please wait and retry.', requestId };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      const r = typeof response === 'object' && response !== null ? (response as Record<string, unknown>) : {};
      body = {
        code: typeof r.code === 'string' ? r.code : (CODE_BY_STATUS[status] ?? 'ERROR'),
        message:
          typeof r.message === 'string'
            ? r.message
            : typeof response === 'string'
              ? response
              : exception.message,
        requestId,
        ...(Array.isArray(r.details) ? { details: r.details as { path: string; message: string }[] } : {}),
      };
    } else {
      this.logger.error({ err: exception, requestId }, 'Unhandled error');
    }

    // Messages are written in English and sent in the reader's language (Accept-Language); codes stay as they are.
    const language = pickLanguage(req.headers?.['accept-language']);
    if (language !== 'en') {
      body = {
        ...body,
        message: localize(body.message, language),
        ...(body.details ? { details: body.details.map((d) => ({ ...d, message: localize(d.message, language) })) } : {}),
      };
    }

    res.status(status).json({ error: body } satisfies ApiErrorBody);
  }
}
