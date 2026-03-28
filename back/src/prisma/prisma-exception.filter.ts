import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

const isProd = process.env.NODE_ENV === 'production';

function messageForKnown(
  exception: Prisma.PrismaClientKnownRequestError,
): string {
  switch (exception.code) {
    case 'P2021':
      return (
        'В базе нет нужных таблиц. В каталоге back выполните: npx prisma db push ' +
        '(убедитесь, что DATABASE_URL указывает на ваш Postgres).'
      );
    case 'P1001':
      return (
        'Не удаётся подключиться к базе. Проверьте DATABASE_URL и что PostgreSQL запущен.'
      );
    case 'P2002':
      return 'Запись с таким уникальным полем уже существует.';
    case 'P2025':
      return 'Запись не найдена.';
    default:
      return isProd ? 'Ошибка базы данных.' : exception.message;
  }
}

function isFetchFailedMessage(msg: string | undefined): boolean {
  return !!msg && /fetch failed/i.test(msg);
}

/** Prisma с accelerateUrl (prisma+… / prisma://) ходит по HTTP; без доступного endpoint — TypeError «fetch failed». */
function explainFetchFailed(err: Error): string {
  const cause =
    'cause' in err && (err as Error & { cause?: unknown }).cause != null
      ? String((err as Error & { cause?: unknown }).cause)
      : '';
  const tail = cause ? ` Детали: ${cause}` : '';
  return (
    'Prisma не смог выполнить сетевой запрос (fetch failed). ' +
    'Часто это DATABASE_URL вида prisma+… или prisma://… (Accelerate / Prisma Dev): ' +
    'нужен доступ к этому сервису (локально — «npx prisma dev»). ' +
    'Для Docker/обычного Postgres используйте postgresql://…@db:5432/… без prisma+.' +
    tail
  );
}

function statusForKnown(
  exception: Prisma.PrismaClientKnownRequestError,
): HttpStatus {
  switch (exception.code) {
    case 'P2002':
      return HttpStatus.CONFLICT;
    case 'P2025':
      return HttpStatus.NOT_FOUND;
    default:
      return HttpStatus.INTERNAL_SERVER_ERROR;
  }
}

/**
 * Один фильтр: Prisma (все типы), HttpException как у Nest, остальное — с логом и текстом в dev.
 */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const body =
        typeof payload === 'string'
          ? { statusCode: status, message: payload }
          : { statusCode: status, ...(payload as object) };
      return res.status(status).json(body);
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const status = statusForKnown(exception);
      return res.status(status).json({
        statusCode: status,
        message: messageForKnown(exception),
        ...(isProd ? {} : { code: exception.code, meta: exception.meta }),
      });
    }

    if (exception instanceof Prisma.PrismaClientInitializationError) {
      this.logger.error(exception.message);
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: isProd
          ? 'Не удалось подключиться к базе данных.'
          : `${exception.message} Проверьте DATABASE_URL; для prisma+ URL нужен «npx prisma dev» или postgresql://…`,
      });
    }

    if (exception instanceof Prisma.PrismaClientUnknownRequestError) {
      this.logger.error(exception.message);
      const msg = isFetchFailedMessage(exception.message)
        ? explainFetchFailed(exception)
        : isProd
          ? 'Ошибка базы данных.'
          : exception.message;
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: msg,
      });
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      this.logger.error(exception.message);
      return res.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        message: isProd ? 'Некорректные данные для запроса к базе.' : exception.message,
      });
    }

    if (exception instanceof Prisma.PrismaClientRustPanicError) {
      this.logger.error(exception.message);
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: isProd ? 'Внутренняя ошибка базы данных.' : exception.message,
      });
    }

    const err = exception instanceof Error ? exception : undefined;
    this.logger.error(err?.stack ?? String(exception));

    let fallback = err?.message ?? 'Internal server error';
    if (err && isFetchFailedMessage(fallback)) {
      fallback = isProd
        ? 'Сетевая ошибка Prisma (fetch failed). Проверьте DATABASE_URL: для Postgres нужен postgresql://…, не prisma+…'
        : explainFetchFailed(err);
    } else if (isProd) {
      fallback = 'Internal server error';
    }

    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: fallback,
    });
  }
}
