import { loadApiEnv } from '@dealflow/config';
import { createApp } from './bootstrap';

async function main(): Promise<void> {
  const env = loadApiEnv();
  const app = await createApp();
  await app.listen(env.API_PORT);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
