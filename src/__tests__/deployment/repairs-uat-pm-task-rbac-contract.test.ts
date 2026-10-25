import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const productionSeed = fs.readFileSync('prisma/seed.ts', 'utf8');
const uatSeed = fs.readFileSync('scripts/seed-repairs-uat-rbac.ts', 'utf8');
const governanceUat = fs.readFileSync('e2e/repairs/scenario-x-pm-governance.spec.ts', 'utf8');

function roleBlock(source: string, role: string, nextRole: string): string {
  const start = source.indexOf(`${role}: [`);
  const end = source.indexOf(`${nextRole}: [`, start + 1);
  if (start < 0 || end < 0) return '';
  return source.slice(start, end);
}

describe('Repairs UAT PM Task Library regression contracts', () => {
  it('keeps the maintenance planner Task Library grants aligned with production', () => {
    const productionPlanner = roleBlock(productionSeed, 'maintenance_planner', 'maintenance_supervisor');
    const uatPlanner = roleBlock(uatSeed, 'maintenance_planner', 'maintenance_supervisor');
    const required = ['pm_tasks.view', 'pm_tasks.create', 'pm_tasks.update', 'pm_tasks.delete', 'pm_tasks.import'];

    for (const permission of required) {
      expect(productionPlanner).toContain(`'${permission}'`);
      expect(uatPlanner).toContain(`'${permission}'`);
    }
  });

  it('asserts the rendered Task Description label used by the template task list', () => {
    expect(governanceUat).toContain("getByText(`Task Description: ${firstTask}`, { exact: true })");
    expect(governanceUat).toContain("getByText(`Task Description: ${lastTask}`, { exact: true })");
  });
});
