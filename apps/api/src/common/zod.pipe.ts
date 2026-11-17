import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodType, ZodTypeDef } from 'zod';

/** Validates and normalises a request body or query with a shared Zod schema. */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  // The input type is left open: schemas that transform (a JSON query parameter into a list) take a string in.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly schema: ZodType<T, ZodTypeDef, any>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'The request contains invalid fields.',
      details: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
}
