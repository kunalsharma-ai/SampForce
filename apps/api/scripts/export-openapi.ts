import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildOpenApiDocument } from '../src/openapi/document';

/** Writes the OpenAPI document to docs/api/openapi.json for reviewers and client generators. */
const out = resolve(__dirname, '../../../docs/api/openapi.json');
mkdirSync(resolve(out, '..'), { recursive: true });
writeFileSync(out, `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`);
process.stdout.write(`wrote ${out}\n`);
