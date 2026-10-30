import { createAiFixture } from './ai-fixture';

/** Standalone AI fixture for the Playwright suite: `tsx test/fixtures/ai-fixture-server.ts`. */
const port = Number(process.env.AI_FIXTURE_PORT ?? 4100);
createAiFixture(port).then((f) => process.stdout.write(`AI fixture listening on ${f.url}\n`));
