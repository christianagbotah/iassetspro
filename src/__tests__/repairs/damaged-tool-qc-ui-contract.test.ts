import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ui = readFileSync(join(process.cwd(), 'src/components/modules/RepairsPagesLegacy.tsx'), 'utf8');

describe('damaged tool QC operator UI contract', () => {
  it('shows an Awaiting QC lifecycle state', () => {
    expect(ui).toContain("{ key: 'awaiting_qc', label: 'Awaiting QC'");
    expect(ui).toContain('<SelectItem value="awaiting_qc">Awaiting QC</SelectItem>');
  });

  it('offers store roles an explicit QC acceptance action', () => {
    expect(ui).toContain('canAcceptRepairQC');
    expect(ui).toContain('Accept QC');
    expect(ui).toContain("handleAction(actionTarget.id, 'accept_repair'");
    expect(ui).toContain('htmlFor="damaged-tool-qc-notes"');
    expect(ui).toContain('id="damaged-tool-qc-notes"');
  });

  it('keeps awaiting-QC reports eligible for write-off when inspection fails', () => {
    expect(ui).toContain("!['repaired', 'written_off', 'replaced'].includes(r.status)");
  });

  it('shows QC acceptance in the damage timeline', () => {
    expect(ui).toContain("{ label: 'QC Accepted', date: detailItem.qcAcceptedAt");
  });
});
