import { indexSpecs, Prisma } from '@dealflow/database';
import { describe, expect, it } from 'vitest';

/**
 * Prisma reads a relation (a `_count`, a `some` / `none` filter) with a MongoDB `$lookup` that matches on the foreign
 * key alone, without the workspace field. An index that starts with the workspace field cannot serve it, so without
 * an index on the foreign key itself every lookup scans the whole collection (Accounts took over 10 s on 2,000
 * companies). Every one-to-many relation outside the workspace link needs an index that starts with its foreign key.
 */
describe('relation indexes', () => {
  it('indexes the foreign key of every one-to-many relation', () => {
    const specs = indexSpecs();
    const models = Prisma.dmmf.datamodel.models;
    const missing: string[] = [];
    for (const model of models) {
      const collection = model.dbName ?? model.name;
      for (const field of model.fields) {
        if (field.kind !== 'object' || !field.relationFromFields?.length) continue;
        const fk = field.relationFromFields[0]!;
        if (fk === 'tenantId') continue;
        const target = models.find((m) => m.name === field.type);
        const backIsList = target?.fields.some((f) => f.relationName === field.relationName && f.isList);
        if (!backIsList) continue;
        const column = model.fields.find((f) => f.name === fk)?.dbName ?? fk;
        const indexed = column === '_id' || specs.some((s) => s.collection === collection && Object.keys(s.key)[0] === column);
        if (!indexed) missing.push(`${model.name}.${fk}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
