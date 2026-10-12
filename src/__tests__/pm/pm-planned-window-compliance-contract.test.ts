import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { calculatePmPlannedEnd } from '@/services/pm/plannedWindow.service';

const due = fs.readFileSync('src/app/api/pm-schedules/check-due/route.ts', 'utf8');
const meter = fs.readFileSync('src/services/pm/meterTriggerEngine.ts', 'utf8');
const signal = fs.readFileSync('src/services/pm/conditionProductionTriggerEngine.ts', 'utf8');
const analytics = fs.readFileSync('src/app/api/pm-analytics/route.ts', 'utf8');
const ui = fs.readFileSync('src/components/modules/MaintenancePages.tsx', 'utf8');

describe('PM planned window and compliance contract', () => {
  it('derives planned end from start plus estimated maintenance duration', () => {
    const start = new Date('2026-10-06T08:00:00.000Z');
    expect(calculatePmPlannedEnd(start, 2.5)?.toISOString()).toBe('2026-10-06T10:30:00.000Z');
    expect(calculatePmPlannedEnd(start, 0)).toBeNull();
    expect(calculatePmPlannedEnd(start, Number.NaN)).toBeNull();
  });

  it('writes plannedEnd from every automatic PM generation path', () => {
    for (const source of [due, meter, signal]) {
      expect(source).toContain('calculatePmPlannedEnd');
      expect(source).toContain('plannedEnd,');
    }
  });

  it('does not classify completed PM work with no deadline as on-time', () => {
    expect(analytics).toContain('complianceEligibleWos');
    expect(analytics).toContain('unplannedCompletedCount');
    expect(analytics).not.toContain('if (!wo.actualEnd || !wo.plannedEnd) return true');
  });

  it('treats verified PM work orders as completed compliance outcomes', () => {
    expect(analytics).toContain("wo.status === 'verified'");
  });

  it('keeps department completed-WO totals separate from compliance eligibility', () => {
    expect(analytics).toContain('deptCompletedMap');
    expect(analytics).toContain('for (const wo of completedPmWos)');
    expect(analytics).toContain('completedWos: deptCompletedMap.get(d.departmentId!) || 0');
    expect(analytics).toContain('for (const wo of complianceEligibleWos)');
  });

  it('buckets monthly PM completions by actual completion month', () => {
    expect(analytics).toContain('const completionKey =');
    expect(analytics).toContain('const completedAt = new Date(wo.actualEnd)');
    expect(analytics).not.toContain('if (wo.actualEnd) entry.completed += 1');
  });

  it('shows unavailable compliance as N/A rather than a false 0 or 100 percent', () => {
    expect(ui).toContain("pmAnalytics.complianceRate == null ? 'N/A'");
  });

  it('does not relabel the planned-vs-reactive ratio as PM compliance', () => {
    expect(ui).not.toContain('const pmCompliance = stats?.maintenanceKPIs?.plannedRatio ?? 0;');
    expect(ui).toContain('const plannedRatio = stats?.maintenanceKPIs?.plannedRatio ?? 0;');
    expect(ui).toContain('>Planned Ratio</p>');
    expect(ui).toContain('{plannedRatio}%');
    expect(ui).toContain('planned vs reactive');
  });

  it('sources the Maintenance Analytics PM Compliance KPI from canonical PM analytics', () => {
    const start = ui.indexOf('export function MaintenanceAnalyticsPage()');
    expect(start).toBeGreaterThanOrEqual(0);
    const analyticsPage = ui.slice(start);
    expect(analyticsPage).not.toContain('const pmCompliance = totalWOs > 0 ? Math.round((preventiveWOs / totalWOs) * 100) : 0;');
    expect(analyticsPage).toContain("'/api/pm-analytics'");
    expect(analyticsPage).toContain("pmAnalytics?.complianceRate == null ? 'N/A'");
    expect(analyticsPage).toContain("label: 'PM Compliance'");
  });
});
