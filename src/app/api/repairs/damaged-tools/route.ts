import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession, isAdmin, hasRole } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit';
import { notifyUser } from '@/lib/notifications';
import { getPlantScope, applyPlantScope, canAccessPlantStrict } from '@/lib/plant-scope';

// Helper: generate auto-number DTR-YYYYMM-NNNN
async function generateReportNumber(): Promise<string> {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prefix = `DTR-${ym}-`;

  const lastRecord = await db.damagedToolReport.findFirst({
    where: { reportNumber: { startsWith: prefix } },
    orderBy: { reportNumber: 'desc' },
    select: { reportNumber: true },
  });

  let seq = 1;
  if (lastRecord) {
    const numPart = lastRecord.reportNumber.slice(prefix.length);
    seq = (parseInt(numPart, 10) || 0) + 1;
  }

  return `${prefix}${String(seq).padStart(4, '0')}`;
}

// GET /api/repairs/damaged-tools
export async function GET(request: NextRequest) {
  try {
    const session = getSession(request);
    if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });

    const plantScope = await getPlantScope(request, session);
    if (plantScope.denyAccess) return NextResponse.json({ success: true, data: [], total: 0 });

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || undefined;
    const workOrderId = searchParams.get('workOrderId') || undefined;
    const plantId = searchParams.get('plantId') || undefined;
    const toolId = searchParams.get('toolId') || undefined;
    const damageType = searchParams.get('damageType') || undefined;
    const stats = searchParams.get('stats') === 'true';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const search = searchParams.get('search') || undefined;

    // Stats mode
    if (stats) {
      const plantFilter = applyPlantScope({}, plantScope);
      const [total, byStatus, bySeverity, byType] = await Promise.all([
        db.damagedToolReport.count({ where: { plantId: plantId || undefined, ...plantFilter } }),
        db.damagedToolReport.groupBy({
          by: ['status'],
          where: { plantId: plantId || undefined, ...plantFilter },
          _count: { id: true },
        }),
        db.damagedToolReport.groupBy({
          by: ['damageSeverity'],
          where: { plantId: plantId || undefined, ...plantFilter },
          _count: { id: true },
        }),
        db.damagedToolReport.groupBy({
          by: ['damageType'],
          where: { plantId: plantId || undefined, ...plantFilter },
          _count: { id: true },
        }),
      ]);

      const statusCounts: Record<string, number> = {};
      for (const g of byStatus) statusCounts[g.status] = g._count.id;

      const severityCounts: Record<string, number> = {};
      for (const g of bySeverity) severityCounts[g.damageSeverity] = g._count.id;

      const typeCounts: Record<string, number> = {};
      for (const g of byType) typeCounts[g.damageType] = g._count.id;

      const pendingAssessment = await db.damagedToolReport.count({
        where: { status: 'reported', plantId: plantId || undefined, ...plantFilter },
      });

      const inRepair = await db.damagedToolReport.count({
        where: { status: 'repair_in_progress', plantId: plantId || undefined, ...plantFilter },
      });

      const totalRepairCost = await db.damagedToolReport.aggregate({
        where: { plantId: plantId || undefined, actualRepairCost: { not: null }, ...plantFilter },
        _sum: { actualRepairCost: true },
      });

      return NextResponse.json({
        success: true,
        data: {
          total,
          byStatus: statusCounts,
          bySeverity: severityCounts,
          byType: typeCounts,
          pendingAssessment,
          inRepair,
          totalRepairCost: totalRepairCost._sum.actualRepairCost || 0,
        },
      });
    }

    // List mode
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (workOrderId) where.workOrderId = workOrderId;
    if (plantId) where.plantId = plantId;
    if (toolId) where.toolId = toolId;
    if (damageType) where.damageType = damageType;
    // Apply plant scope filter
    Object.assign(where, applyPlantScope({}, plantScope));
    if (search) {
      where.OR = [
        { reportNumber: { contains: search } },
        { damageDescription: { contains: search } },
      ];
    }

    // Scope to user's own reports unless management role
    const hasViewAll = isAdmin(session) || hasRole(session, 'maintenance_supervisor') || hasRole(session, 'maintenance_manager') || hasRole(session, 'plant_manager') || hasRole(session, 'store_keeper') || hasRole(session, 'tools_shop_attendant') || hasRole(session, 'inventory_manager');
    if (!hasViewAll) {
      where.reportedById = session.userId;
    }

    const [reports, total] = await Promise.all([
      db.damagedToolReport.findMany({
        where,
        include: {
          tool: { select: { id: true, toolCode: true, name: true, category: true, status: true } },
          workOrder: { select: { id: true, woNumber: true, title: true, status: true } },
          reportedBy: { select: { id: true, fullName: true, username: true, avatar: true } },
          technician: { select: { id: true, fullName: true, username: true } },
          repairCompletedBy: { select: { id: true, fullName: true } },
          writtenOffBy: { select: { id: true, fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: Math.min(limit, 100),
      }),
      db.damagedToolReport.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: reports,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch damaged tool reports';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// POST /api/repairs/damaged-tools
export async function POST(request: NextRequest) {
  try {
    const session = getSession(request);
    if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });

    const canCreate = isAdmin(session) || hasRole(session, 'maintenance_technician') || hasRole(session, 'maintenance_supervisor') || hasRole(session, 'maintenance_manager') || hasRole(session, 'store_keeper') || hasRole(session, 'tools_shop_attendant') || hasRole(session, 'inventory_manager');
    if (!canCreate) {
      return NextResponse.json({ success: false, error: 'Insufficient permissions' }, { status: 403 });
    }

    const body = await request.json();
    const {
      toolId,
      workOrderId,
      toolRequestId,
      damageType,
      damageSeverity,
      damageDescription,
      damagePhotoUrls,
      occurredAt,
      technicianId,
      plantId,
      quantity: quantityInput,
    } = body;

    if (!toolId || !damageType || !damageDescription) {
      return NextResponse.json(
        { success: false, error: 'toolId, damageType, and damageDescription are required' },
        { status: 400 },
      );
    }
    const quantity = Number.parseInt(String(quantityInput ?? 1), 10);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return NextResponse.json({ success: false, error: 'quantity must be a positive whole number' }, { status: 400 });
    }

    // Verify tool exists
    const tool = await db.tool.findUnique({
      where: { id: toolId },
      include: { assignedTo: { select: { id: true, fullName: true } } },
    });
    if (!tool) {
      return NextResponse.json({ success: false, error: 'Tool not found' }, { status: 404 });
    }
    if (plantId && tool.plantId && plantId !== tool.plantId) {
      return NextResponse.json({ success: false, error: 'Reported plant does not match the tool plant' }, { status: 400 });
    }

    // Resolve and enforce plant custody before any stock mutation.
    const resolvedPlantId = plantId || tool.plantId || null;
    const plantScope = await getPlantScope(request, session);
    if (plantScope.denyAccess || !canAccessPlantStrict(plantScope, resolvedPlantId)) {
      return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
    }

    // Resolve technicianId to the tool's current assignee if not provided
    const resolvedTechnicianId = technicianId || tool.assignedToId || null;

    const reportNumber = await generateReportNumber();
    const storeHeldDamage = !workOrderId && !toolRequestId && !tool.assignedToId && tool.status === 'available';
    if (storeHeldDamage && quantity > tool.quantity) {
      return NextResponse.json(
        { success: false, error: `Damage quantity (${quantity}) exceeds usable store stock (${tool.quantity})` },
        { status: 400 },
      );
    }

    const report = await db.$transaction(async (tx) => {
      let repairHeldQuantity = 0;
      if (storeHeldDamage) {
        const remainingUsable = tool.quantity - quantity;
        const toolClaim = await tx.tool.updateMany({
          where: {
            id: toolId,
            quantity: tool.quantity,
            repairQuantity: tool.repairQuantity,
            status: tool.status,
            assignedToId: tool.assignedToId,
          },
          data: {
            quantity: { decrement: quantity },
            repairQuantity: { increment: quantity },
            status: remainingUsable > 0 ? 'available' : 'in_repair',
            ...(remainingUsable <= 0 ? { condition: damageSeverity === 'low' ? 'poor' : 'damaged' } : {}),
          },
        });
        if (toolClaim.count !== 1) throw new Error('Tool stock/custody changed concurrently while reporting damage');
        repairHeldQuantity = quantity;
      }

      const created = await tx.damagedToolReport.create({
        data: {
          reportNumber,
          toolId,
          workOrderId: workOrderId || null,
          toolRequestId: toolRequestId || null,
          damageType,
          damageSeverity: damageSeverity || 'medium',
          damageDescription,
          damagePhotoUrls: damagePhotoUrls || '[]',
          quantity,
          repairHeldQuantity,
          occurredAt: occurredAt ? new Date(occurredAt) : null,
          reportedById: session.userId,
          technicianId: resolvedTechnicianId,
          plantId: resolvedPlantId,
        },
        include: {
          tool: { select: { id: true, toolCode: true, name: true } },
          workOrder: { select: { id: true, woNumber: true, title: true } },
          reportedBy: { select: { id: true, fullName: true } },
          technician: { select: { id: true, fullName: true } },
        },
      });

      await tx.toolTransaction.create({
        data: {
          toolId,
          type: storeHeldDamage ? 'repair_start' : 'damage_report',
          notes: storeHeldDamage
            ? `Damage reported and ${quantity}x quarantined for repair: ${reportNumber}`
            : `Operational damage reported; physical custody pending return: ${reportNumber}`,
          performedById: session.userId,
          workOrderId: workOrderId || null,
        },
      });

      return created;
    });

    // Audit log
    await createAuditLog(session.userId, 'DamagedToolReport', 'create', report.id, {
      newValues: {
        reportNumber,
        toolId,
        damageType,
        damageSeverity,
      },
    });

    // Notify tool manager/supervisor
    if (resolvedTechnicianId && resolvedTechnicianId !== session.userId) {
      await notifyUser(
        resolvedTechnicianId,
        'tool_damaged',
        'Tool Damage Report Filed',
        `${reportNumber}: ${tool.name} (${tool.toolCode}) - ${damageType}`,
        'damaged_tool', report.id, 'damaged-tools',
      ).catch(() => {});
    }

    return NextResponse.json({ success: true, data: report }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to create damaged tool report';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
