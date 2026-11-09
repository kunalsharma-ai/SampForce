import { Inject, Injectable } from '@nestjs/common';
import { createPrismaClient, type DbContext, type SampforceClient, type TenantTx, withDbContext } from '@dealflow/database';
import { API_ENV, type ApiEnv } from './env';

type PrismaServiceApi = SampforceClient & {
  /** Runs `fn` in a MongoDB transaction scoped to the given workspace and user (see packages/database/src/scope.ts). */
  run<T>(ctx: DbContext, fn: (tx: TenantTx) => Promise<T>, options?: { timeoutMs?: number }): Promise<T>;
  onModuleDestroy(): Promise<void>;
};

function build(url: string): PrismaServiceApi {
  const client = createPrismaClient(url);
  return client.$extends({
    client: {
      run<T>(ctx: DbContext, fn: (tx: TenantTx) => Promise<T>, options?: { timeoutMs?: number }): Promise<T> {
        return withDbContext(client, ctx, fn, options);
      },
      async onModuleDestroy(): Promise<void> {
        await client.$disconnect();
      },
    },
  }) as unknown as PrismaServiceApi;
}

/**
 * The guarded Prisma client as a Nest provider. Prisma client extensions return a new object rather than a
 * subclass, so the constructor returns that object; the interface below gives the class its type.
 */
@Injectable()
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class PrismaService {
  constructor(@Inject(API_ENV) env: ApiEnv) {
    return build(env.DATABASE_URL) as unknown as PrismaService;
  }
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging, @typescript-eslint/no-empty-object-type
export interface PrismaService extends PrismaServiceApi {}
