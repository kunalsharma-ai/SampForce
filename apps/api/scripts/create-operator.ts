// The code lives in src/cli so it is also compiled into the production image (node dist/cli/create-operator.js).
// This file keeps `pnpm --filter @dealflow/api operator:create` working from a source checkout.
import '../src/cli/create-operator';
