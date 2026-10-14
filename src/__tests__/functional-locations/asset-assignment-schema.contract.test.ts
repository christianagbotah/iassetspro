import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const schema = read('prisma/schema.prisma');

describe('asset functional-location assignment history schema', () => {
  it('models historical asset placement independently from the Asset row', () => {
    expect(schema).toContain('model AssetFunctionalLocationAssignment {');
    expect(schema).toContain('assetId              String');
    expect(schema).toContain('hierarchySystemId    String');
    expect(schema).toContain('functionalLocationId String');
    expect(schema).toContain('effectiveFrom        DateTime');
    expect(schema).toContain('effectiveTo          DateTime?');
    expect(schema).toContain('locationCodeSnapshot String');
    expect(schema).toContain('locationPathSnapshot String');
    expect(schema).toContain('assignedById         String');
    expect(schema).toContain('endedById            String?');
    expect(schema).toContain('reason               String?');
    expect(schema).toContain('endReason            String?');
  });

  it('relates assignment history to asset, hierarchy system, functional location, and actors', () => {
    expect(schema).toContain('@relation(fields: [assetId], references: [id], onDelete: Cascade)');
    expect(schema).toContain('@relation(fields: [hierarchySystemId], references: [id], onDelete: Restrict)');
    expect(schema).toContain('@relation(fields: [functionalLocationId], references: [id], onDelete: Restrict)');
    expect(schema).toContain('@relation("AssetLocationAssignedBy"');
    expect(schema).toContain('@relation("AssetLocationEndedBy"');
  });

  it('uses a database partial unique index for one active assignment per asset and hierarchy system', () => {
    const migration = read('prisma/migrations/20261014090000_asset_functional_location_assignments/migration.sql');
    expect(migration).toContain('CREATE UNIQUE INDEX');
    expect(migration).toContain('"assetId"');
    expect(migration).toContain('"hierarchySystemId"');
    expect(migration).toMatch(/WHERE\s+"effectiveTo"\s+IS\s+NULL/i);
  });
});
