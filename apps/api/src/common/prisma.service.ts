import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { type DbContext, PrismaClient, type TenantTx, withDbContext } from '@dealflow/database';
import { API_ENV, type ApiEnv } from './env';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(API_ENV) env: ApiEnv) {
    super({ datasources: { db: { url: env.DATABASE_URL } } });
  }

  /** Runs `fn` with row-level security scoped to the given tenant and user. */
  run<T>(ctx: DbContext, fn: (tx: TenantTx) => Promise<T>, options?: { timeoutMs?: number }): Promise<T> {
    return withDbContext(this, ctx, fn, options);
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
