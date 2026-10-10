import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('material return condition custody contract', () => {
  it('requires store reconciliation to pass return condition into custody service', () => {
    const source = read('src/app/api/repairs/material-requests/reconcile/route.ts');
    expect(source).toContain('returnCondition');
    expect(source).toMatch(/reconcileMaterialRequest\([\s\S]*returnCondition/);
    expect(source).toContain('additionalReturnedToHold');
    expect(source).toContain('additionalReturnedToStock');
    expect(source).toContain('quantityApproved: true');
    expect(source).toMatch(/quantityIssued\s*\|\|\s*declaration\.quantityApproved/);
  });

  it('requires direct record_return to pass return condition into custody service', () => {
    const source = read('src/app/api/repairs/material-requests/[id]/route.ts');
    expect(source).toContain('returnCondition');
    expect(source).toMatch(/recordMaterialReturn\([\s\S]*condition:\s*returnCondition/);
  });

  it('requires operators to classify physical material returns before store acceptance', () => {
    const source = read('src/components/modules/RepairsPagesLegacy.tsx');
    expect(source).toContain("returnCondition: ''");
    expect(source).toContain('Return condition');
    expect(source).toContain('Serviceable — return to usable stock');
    expect(source).toContain('Damaged — quarantine for inspection / repair');
    expect(source).toContain('Defective — quarantine for inspection / repair');
    expect(source).toMatch(/returnCondition:\s*reconcileForm\.returnCondition/);
    expect(source).toMatch(/returnCondition:\s*condition/);
  });
});
