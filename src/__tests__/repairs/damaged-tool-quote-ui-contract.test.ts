import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ui = readFileSync(join(process.cwd(), 'src/components/modules/RepairsPagesLegacy.tsx'), 'utf8');

describe('damaged tool quote-to-repair UI contract', () => {
  it('includes repair quoted in the operator lifecycle', () => {
    expect(ui).toContain("{ key: 'repair_quoted', label: 'Quoted'");
  });

  it('quotes an assessed repair before allowing repair start', () => {
    expect(ui).toContain("r.status === 'assessed'");
    expect(ui).toContain("action: 'quote_repair'");
    expect(ui).toContain('Quote Repair');
    expect(ui).toContain("r.status === 'repair_quoted'");
    expect(ui).toContain("handleAction(r.id, 'start_repair')");
  });

  it('submits vendor and estimated cost through quote_repair', () => {
    expect(ui).toContain("actionTarget?.action === 'quote_repair'");
    expect(ui).toContain("handleAction(actionTarget.id, 'quote_repair'");
  });
});
