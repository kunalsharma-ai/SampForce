// The code lives in src/cli so it is also compiled into the production image (node dist/cli/reseal-secrets.js).
// This file keeps `pnpm --filter @dealflow/api secrets:reseal` working from a source checkout.
import '../src/cli/reseal-secrets';
