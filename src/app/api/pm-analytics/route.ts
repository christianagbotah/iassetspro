import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession, hasPermission } from '@/lib/auth';
import { getPlantScope } from '@/lib/plant-scope';

/**
 * GET /api/pm-analytics
 *
 * Returns comprehensive PM program health metrics:
 * - complianceRate: % of PM WOs completed within their planned end date
 * - overdueCount: Active PM schedules past their nextDueDate
 * - upcomingCount: PM schedules due within next 7 days
 * - totalSchedules: Total active schedules
 * - totalGenerated: Total WOs generated from PM schedules
 * - avgCompletionDays: Average days from WO creation to completion for PM WOs
 * - byDepartment: Breakdown by department (counts and compliance)
 * - monthlyTrend: Last 12 months of PM WO generation (month, generated, completed)
 */
export async function GET(request: NextRequest) {
  try {
    const session = getSession(request);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    if (!hasPermission(session, 'pm_analytics.view')) {
      return NextResponse.json({ success: false, error: 'Insufficient permissions' }, { status: 403 });
    }

    const plantScope = await getPlantScope(request, session);
    if (plantScope.denyAccess) {
      return NextResponse.json({ success: false, error: 'Plant access denied' }, { status: 403 });
    }

    const allowedPlantIds = plantScope.isSystemWide
      ? null
      : plantScope.isScoped && plantScope.plantId
        ? [plantScope.plantId]
        : plantScope.accessiblePlantIds;
    const scopedPlantIds = allowedPlantIds === null
      ? null
      : allowedPlantIds.length > 0 ? allowedPlantIds : ['__ACCESS_DENIED__'];
    const assetScopeWhere = scopedPlantIds === null
      ? {}
      : { asset: { plantId: { in: scopedPlantIds } } };
    const workOrderScopeWhere = scopedPlantIds === null
      ? {}
      : { plantId: { in: scopedPlantIds } };

    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // ── Run independent queries in parallel ──

    const [
      totalSchedules,
      overdueSchedules,
      upcomingSchedules,
      pmWorkOrders,
      departmentBreakdown,
    ] = await Promise.all([
      // 1. Total active schedules
      db.pmSchedule.count({ where: { isActive: true, ...assetScopeWhere } }),

      // 2. Overdue schedules (nextDueDate < now and active)
      db.pmSchedule.count({
        where: {
          isActive: true,
          ...assetScopeWhere,
          frequencyType: { notIn: ['meter_based', 'custom_hours'] },
          nextDueDate: { not: null, lt: now },
        },
      }),

      // 3. Upcoming schedules (due within 7 days)
      db.pmSchedule.count({
        where: {
          isActive: true,
          ...assetScopeWhere,
          frequencyType: { notIn: ['meter_based', 'custom_hours'] },
          nextDueDate: { not: null, gte: now, lte: weekFromNow },
        },
      }),

      // 4. All PM work orders (generated from schedules) with completion info
      db.workOrder.findMany({
        where: { pmScheduleId: { not: null }, ...workOrderScopeWhere },
        select: {
          id: true,
          createdAt: true,
          actualEnd: true,
          plannedEnd: true,
          status: true,
          departmentId: true,
        },
      }),

      // 5. Department breakdown — schedule counts per department
      db.pmSchedule.groupBy({
        by: ['departmentId'],
        where: { isActive: true, departmentId: { not: null }, ...assetScopeWhere },
        _count: { id: true },
      }),
    ]);

    // ── Compute compliance rate ──
    // PM WOs completed on or before their planned end date
    const completedPmWos = pmWorkOrders.filter(
      (wo) => wo.status === 'completed' || wo.status === 'verified' || wo.status === 'closed',
    );
    const complianceEligibleWos = completedPmWos.filter((wo) => wo.actualEnd && wo.plannedEnd);
    const completedOnTime = complianceEligibleWos.filter(
      (wo) => new Date(wo.actualEnd!).getTime() <= new Date(wo.plannedEnd!).getTime(),
    ).length;
    const unplannedCompletedCount = completedPmWos.length - complianceEligibleWos.length;

    const complianceRate = complianceEligibleWos.length > 0
      ? Math.round((completedOnTime / complianceEligibleWos.length) * 100)
      : null;

    // ── Compute avg completion days ──
    const wosWithCompletion = completedPmWos.filter((wo) => wo.actualEnd);
    const totalCompletionDays = wosWithCompletion.reduce((sum, wo) => {
      const days = (new Date(wo.actualEnd!).getTime() - new Date(wo.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      return sum + days;
    }, 0);
    const avgCompletionDays =
      wosWithCompletion.length > 0
        ? Math.round((totalCompletionDays / wosWithCompletion.length) * 10) / 10
        : 0;

    // ── Build byDepartment breakdown ──
    // Enrich department group data with compliance info
    const deptIds = departmentBreakdown.map((d) => d.departmentId!);
    const deptNames = deptIds.length > 0
      ? await db.department.findMany({
          where: { id: { in: deptIds } },
          select: { id: true, name: true, code: true },
        })
      : [];

    const deptNameMap = new Map(deptNames.map((d) => [d.id, d]));

    // Keep completed-WO totals independent from compliance eligibility.
    const deptCompletedMap = new Map<string, number>();
    for (const wo of completedPmWos) {
      const dId = wo.departmentId;
      if (!dId) continue;
      deptCompletedMap.set(dId, (deptCompletedMap.get(dId) || 0) + 1);
    }

    // Compute per-department compliance only from work with a measurable planned window.
    const deptComplianceMap = new Map<string, { total: number; onTime: number }>();
    for (const wo of complianceEligibleWos) {
      const dId = wo.departmentId;
      if (!dId) continue;
      const entry = deptComplianceMap.get(dId) || { total: 0, onTime: 0 };
      entry.total++;
      if (new Date(wo.actualEnd!).getTime() <= new Date(wo.plannedEnd!).getTime()) {
        entry.onTime++;
      }
      deptComplianceMap.set(dId, entry);
    }

    const byDepartment = departmentBreakdown.map((d) => {
      const dept = deptNameMap.get(d.departmentId!);
      const compliance = deptComplianceMap.get(d.departmentId!);
      return {
        departmentId: d.departmentId,
        departmentName: dept?.name || 'Unknown',
        departmentCode: dept?.code || '—',
        scheduleCount: d._count.id,
        completedWos: deptCompletedMap.get(d.departmentId!) || 0,
        complianceRate: compliance && compliance.total > 0
          ? Math.round((compliance.onTime / compliance.total) * 100)
          : null,
      };
    });

    // ── Build monthly trend (ensure all 12 months present) ──
    // Aggregate in application code so the route remains database-portable after
    // the PostgreSQL migration (the legacy implementation used MySQL DATE_FORMAT).
    const trendMap = new Map<string, { generated: number; completed: number }>();
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    for (const wo of pmWorkOrders) {
      const createdAt = new Date(wo.createdAt);
      if (createdAt < twelveMonthsAgo) continue;
      const generatedKey = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, '0')}`;
      const entry = trendMap.get(generatedKey) || { generated: 0, completed: 0 };
      entry.generated += 1;
      trendMap.set(generatedKey, entry);
    }

    for (const wo of completedPmWos) {
      if (!wo.actualEnd) continue;
      const completedAt = new Date(wo.actualEnd);
      if (completedAt < twelveMonthsAgo || completedAt > now) continue;
      const completionKey = `${completedAt.getFullYear()}-${String(completedAt.getMonth() + 1).padStart(2, '0')}`;
      const entry = trendMap.get(completionKey) || { generated: 0, completed: 0 };
      entry.completed += 1;
      trendMap.set(completionKey, entry);
    }
    const monthlyTrend: Array<{ month: string; generated: number; completed: number }> = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const existing = trendMap.get(key);
      monthlyTrend.push({
        month: key,
        generated: existing?.generated || 0,
        completed: existing?.completed || 0,
      });
    }

    // ── Build final response ──
    return NextResponse.json({
      success: true,
      data: {
        complianceRate,
        complianceEvaluatedCount: complianceEligibleWos.length,
        unplannedCompletedCount,
        overdueCount: overdueSchedules,
        upcomingCount: upcomingSchedules,
        totalSchedules,
        totalGenerated: pmWorkOrders.length,
        avgCompletionDays,
        byDepartment,
        monthlyTrend,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to load PM analytics';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
