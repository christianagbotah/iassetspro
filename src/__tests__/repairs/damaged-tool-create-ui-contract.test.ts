import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const ui = readFileSync(join(process.cwd(), 'src/components/modules/RepairsPagesLegacy.tsx'), 'utf8');

describe('manual damaged tool quantity UI', () => {
  it('tracks a positive damage quantity in create form', () => {
    expect(ui).toContain("quantity: '1'");
    expect(ui).toContain('<Label>Damaged Quantity *</Label>');
  });

  it('submits the reported damage quantity to the API', () => {
    expect(ui).toContain('quantity: parseInt(createForm.quantity, 10) || 1');
  });
});
