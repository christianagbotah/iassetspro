import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession, isAdmin, hasRole, hasPermission, hasAnyPermission } from '@/lib/auth';
import { RESOURCE_STORE_ROLE_SLUGS, canReviewResourceRequestAsSupervisor, isResourceStoreActor } from '@/lib/resource-request-approval';
import { notifyUser } from '@/lib/notifications';
import { getPlantScope, canAccessPlant } from '@/lib/plant-scope';
import { authorizeMaterialRequestPlant } from '@/lib/plant-auth-helpers';
import { isWorkOrderExecutionMember } from '@/services/workOrderAccess.service';
import {
  MaterialCustodyConflictError,
  MaterialCustodyNotFoundError,
  MaterialCustodyValidationError,
  issueMaterialRequest,
  recordMaterialConsumption,
  recordMaterialReturn,
  recordMaterialWaste,
  reserveMaterialRequest,
} from '@/services/materialCustody.service';

// 24-hour threshold for overdue detection
const OVERDUE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

// GET /api/repairs/material-requests/[id]
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = getSession(request);
    if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });

    const { id } = await params;
    const matReq = await db.repairMaterialRequest.findUnique({
      where: { id },
      include: {
        requestedBy: { select: { id: true, fullName: true, username: true, department: true } },
        supervisorApprovedBy: { select: { id: true, fullName: true } },
        storekeeperApprovedBy: { select: { id: true, fullName: true } },
        issuedByUser: { select: { id: true, fullName: true } },
        returnedByUser: { select: { id: true, fullName: true } },
        workOrder: {
          select: {
            id: true, woNumber: true, title: true, status: true, plantId: true,
            assignedTo: true, teamLeaderId: true,
            teamMembers: { select: { userId: true, role: true, accessLevel: true } },
            assignedSupervisor: { select: { id: true, fullName: true } },
            planner: { select: { id: true, fullName: true } },
          },
        },
        item: { select: { id: true, itemCode: true, name: true, currentStock: true, unitOfMeasure: true } },
      },
    });

    if (!matReq) return NextResponse.json({ success: false, error: 'Material request not found' }, { status: 404 });

    // Plant scope validation (through linked work order)
    const plantScope = await getPlantScope(request, session);
    if (plantScope.denyAccess || !canAccessPlant(plantScope, matReq.workOrder?.plantId)) {
      return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
    }

    const hasResourceView = hasAnyPermission(session, [
      'repair_material_requests.view',
      'repair_material_requests.view_all',
      'repair_material_requests.view_own',
    ]) || isAdmin(session);
    if (!hasResourceView) {
      return NextResponse.json({ success: false, error: 'Insufficient permissions' }, { status: 403 });
    }

    const canViewAll = hasAnyPermission(session, [
      'repair_material_requests.view',
      'repair_material_requests.view_all',
    ]) || isAdmin(session);
    const canViewOwnScope = hasPermission(session, 'repair_material_requests.view_own') && (
      matReq.requestedById === session.userId
      || isWorkOrderExecutionMember(session, matReq.workOrder)
    );
    if (!canViewAll && !canViewOwnScope) {
      return NextResponse.json({ success: false, error: 'Access denied — this material request is outside your work-order scope' }, { status: 403 });
    }

    // Compute overdue flag: pending requests older than 24 hours
    const enriched = {
      ...matReq,
      isOverdue:
        matReq.status === 'pending' &&
        Date.now() - new Date(matReq.createdAt).getTime() > OVERDUE_THRESHOLD_MS,
    };

    return NextResponse.json({ success: true, data: enriched });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to load material request';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// PUT /api/repairs/material-requests/[id]
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = getSession(request);
    if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });

    const { id } = await params;
    const plantAuth = await authorizeMaterialRequestPlant(request, session, id);
    if (!plantAuth.ok) return plantAuth.response;

    const existing = await db.repairMaterialRequest.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    // Once approval begins, quantity/cost metadata is part of the audit trail and
    // must not be edited in place. Corrections require cancel/re-request or rework.
    if (existing.status !== 'pending') {
      return NextResponse.json({ success: false, error: 'Only pending requests can be edited' }, { status: 400 });
    }

    // Ownership check: requester or maintenance leadership may edit a pending request.
    if (!isAdmin(session) && !hasRole(session, 'maintenance_supervisor') && !hasRole(session, 'maintenance_manager') && !hasRole(session, 'plant_manager')) {
      if (existing.requestedById !== session.userId) {
        return NextResponse.json({ success: false, error: 'You can only edit your own requests' }, { status: 403 });
      }
    }

    const body = await request.json();
    if (body.unitCost !== undefined) {
      return NextResponse.json({
        success: false,
        error: 'unitCost is server-authoritative and cannot be edited by clients',
      }, { status: 400 });
    }

    const allowedFields: Record<string, unknown> = {};
    if (body.quantityRequested !== undefined) {
      const quantityRequested = Number(body.quantityRequested);
      if (!Number.isFinite(quantityRequested) || quantityRequested <= 0) {
        return NextResponse.json({ success: false, error: 'quantityRequested must be a positive number' }, { status: 400 });
      }
      allowedFields.quantityRequested = quantityRequested;
      allowedFields.estimatedCost = quantityRequested * (existing.unitCost ?? 0);
    }
    if (body.unit !== undefined) {
      if (existing.itemId) {
        return NextResponse.json({
          success: false,
          error: 'unit is server-authoritative for inventory-backed material requests',
        }, { status: 400 });
      }
      if (typeof body.unit !== 'string' || !body.unit.trim()) {
        return NextResponse.json({ success: false, error: 'unit must be a non-empty string' }, { status: 400 });
      }
      allowedFields.unit = body.unit.trim();
    }
    if (body.reason !== undefined) allowedFields.reason = body.reason;
    if (body.notes !== undefined) allowedFields.notes = body.notes;
    if (body.urgency !== undefined && ['low', 'normal', 'high', 'critical'].includes(body.urgency)) {
      allowedFields.urgency = body.urgency;
    }

    const changed = await db.repairMaterialRequest.updateMany({
      where: { id, status: 'pending' },
      data: allowedFields,
    });
    if (changed.count !== 1) {
      return NextResponse.json({ success: false, error: 'Material request changed concurrently' }, { status: 409 });
    }
    const updated = await db.repairMaterialRequest.findUnique({ where: { id } });

    await db.auditLog.create({
      data: {
        userId: session.userId,
        action: 'update',
        entityType: 'repair_material_request',
        entityId: id,
        oldValues: JSON.stringify(existing),
        newValues: JSON.stringify(allowedFields),
      },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update material request';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// DELETE /api/repairs/material-requests/[id] — cancel (only if pending)
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = getSession(request);
    if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });

    const { id } = await params;
    const plantAuth = await authorizeMaterialRequestPlant(request, session, id);
    if (!plantAuth.ok) return plantAuth.response;

    const existing = await db.repairMaterialRequest.findUnique({
      where: { id },
      include: {
        workOrder: { select: { assignedSupervisorId: true } },
      },
    });
    if (!existing) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    if (existing.status !== 'pending') {
      return NextResponse.json({ success: false, error: 'Only pending requests can be cancelled' }, { status: 400 });
    }

    const ownsRequest = existing.requestedById === session.userId;
    const canCancelAsManagement = canReviewResourceRequestAsSupervisor(
      session,
      existing.workOrder?.assignedSupervisorId,
      'repair_material_requests.update',
    );
    if (!ownsRequest && !canCancelAsManagement) {
      return NextResponse.json(
        { success: false, error: 'Only the requester or accountable maintenance management can cancel this pending material request' },
        { status: 403 },
      );
    }

    const cancellation = await db.$transaction(async (tx) => {
      const deleted = await tx.repairMaterialRequest.deleteMany({
        where: { id, status: 'pending' },
      });
      if (deleted.count !== 1) return { cancelled: false };

      if (
        existing.source === 'technician_from_planner_recommendation'
        && existing.itemId
        && existing.workOrderId
      ) {
        await tx.workOrderMaterial.updateMany({
          where: {
            workOrderId: existing.workOrderId,
            itemId: existing.itemId,
            status: 'requested',
          },
          data: { status: 'planned' },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: session.userId,
          action: 'delete',
          entityType: 'repair_material_request',
          entityId: id,
          oldValues: JSON.stringify(existing),
        },
      });

      return { cancelled: true };
    });

    if (!cancellation.cancelled) {
      return NextResponse.json(
        { success: false, error: 'Material request changed concurrently and can no longer be cancelled' },
        { status: 409 },
      );
    }

    return NextResponse.json({ success: true, message: 'Material request cancelled' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to cancel material request';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// POST /api/repairs/material-requests/[id] — workflow actions
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = getSession(request);
    if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });

    const { id } = await params;
    const plantAuth = await authorizeMaterialRequestPlant(request, session, id);
    if (!plantAuth.ok) return plantAuth.response;

    const body = await request.json();
    const { action, approvedQuantity, quantityApproved, quantityReturned, consumedQty, wastedQty, returnQty, notes, returnCondition } = body;

    const matReq = await db.repairMaterialRequest.findUnique({
      where: { id },
      include: {
        workOrder: {
          select: {
            id: true, woNumber: true, title: true,
            assignedSupervisorId: true, plannerId: true, assignedTo: true, teamLeaderId: true,
            teamMembers: { select: { userId: true, role: true } },
          },
        },
        requestedBy: { select: { id: true, fullName: true } },
      },
    });

    if (!matReq) return NextResponse.json({ success: false, error: 'Material request not found' }, { status: 404 });

    const isStoreActor = isResourceStoreActor(session, 'repair_material_requests.update');
    const isExecutionActor =
      matReq.workOrder.assignedTo === session.userId ||
      matReq.workOrder.teamLeaderId === session.userId ||
      matReq.workOrder.teamMembers.some((member) => member.userId === session.userId);

    // ── Role-based access control for workflow actions ──
    if (action === 'supervisor_approve' || action === 'supervisor_reject') {
      if (!canReviewResourceRequestAsSupervisor(session, matReq.workOrder.assignedSupervisorId, 'repair_material_requests.update')) {
        return NextResponse.json({
          success: false,
          error: 'Only the assigned work-order supervisor may review this material request. Maintenance manager, plant manager, or admin may override for escalation.',
        }, { status: 403 });
      }
    }
    if (action === 'storekeeper_approve' || action === 'storekeeper_reject') {
      if (!isStoreActor) {
        return NextResponse.json({ success: false, error: 'Only admin, store keeper, inventory manager, or tools shop attendant can store-approve material requests' }, { status: 403 });
      }
    }
    // Physical custody and final inventory reconciliation stay store-controlled.
    if (action === 'issue' || action === 'record_return' || action === 'reconcile') {
      if (!isStoreActor) {
        return NextResponse.json({
          success: false,
          error: `Only admin, store keeper, inventory manager, or tools shop attendant can perform '${action}' on material requests`,
        }, { status: 403 });
      }
    }
    // Actual usage/waste declarations are submitted by the execution team, not by stores.
    if (action === 'declare_usage' || action === 'consume_material' || action === 'waste_material') {
      if (!isAdmin(session) && !isExecutionActor) {
        return NextResponse.json({
          success: false,
          error: `Only the assigned technician or WO team can perform '${action}'`,
        }, { status: 403 });
      }
    }

    const now = new Date();
    let updated: any;

    switch (action) {
      case 'supervisor_approve': {
        if (matReq.status !== 'pending') {
          return NextResponse.json({ success: false, error: `Cannot approve: current status is ${matReq.status}` }, { status: 400 });
        }
        const qty = approvedQuantity ?? quantityApproved ?? matReq.quantityRequested;
        const claim = await db.repairMaterialRequest.updateMany({
          where: { id, status: 'pending' },
          data: {
            status: 'supervisor_approved',
            supervisorApprovedById: session.userId,
            supervisorApprovedAt: now,
            supervisorApprovedQuantity: qty !== matReq.quantityRequested ? qty : null,
            quantityApproved: qty,
          },
        });
        if (claim.count !== 1) throw new MaterialCustodyConflictError('Supervisor approval was claimed concurrently');
        updated = await db.repairMaterialRequest.findUnique({ where: { id } });

        await db.auditLog.create({
          data: {
            userId: session.userId,
            action: 'material_request_supervisor_approve',
            entityType: 'repair_material_request',
            entityId: id,
            newValues: JSON.stringify({ action: 'supervisor_approve', status: 'supervisor_approved', approvedQuantity: qty, requestedQuantity: matReq.quantityRequested, quantityChanged: qty !== matReq.quantityRequested }),
          },
        });

        const storeKeepers = matReq.plantId
          ? await db.user.findMany({
              where: {
                status: 'active',
                plantAccess: { some: { plantId: matReq.plantId } },
                userRoles: {
                  some: {
                    role: { slug: { in: [...RESOURCE_STORE_ROLE_SLUGS] } },
                  },
                },
              },
              select: { id: true },
            })
          : [];
        for (const sk of storeKeepers) {
          await notifyUser(sk.id, 'repair_material_request', 'Material Request Awaiting Store Approval', `${qty} ${matReq.unit} of ${matReq.itemName} approved by supervisor for WO ${matReq.workOrder.woNumber}`, 'repair_material_request', id, 'maintenance-work-orders');
        }
        await notifyUser(matReq.requestedById, 'repair_material_request', 'Material Request Supervisor Approved', qty !== matReq.quantityRequested ? `Your request for ${matReq.itemName} was approved (quantity adjusted from ${matReq.quantityRequested} to ${qty})` : `Your request for ${matReq.itemName} was approved by supervisor`, 'repair_material_request', id, `material-requests?id=${id}`);
        break;
      }

      case 'supervisor_reject': {
        if (matReq.status !== 'pending') return NextResponse.json({ success: false, error: `Cannot reject: current status is ${matReq.status}` }, { status: 400 });
        const rejectionNotes = notes ? `[${now.toISOString()}] REJECTED by ${session.userId}: ${notes}` : `[${now.toISOString()}] REJECTED by ${session.userId}`;
        const updatedNotes = matReq.notes ? `${matReq.notes}\n${rejectionNotes}` : rejectionNotes;
        const claim = await db.repairMaterialRequest.updateMany({ where: { id, status: 'pending' }, data: { status: 'rejected', supervisorApprovedById: session.userId, supervisorApprovedAt: now, notes: updatedNotes } });
        if (claim.count !== 1) throw new MaterialCustodyConflictError('Supervisor rejection was claimed concurrently');
        updated = await db.repairMaterialRequest.findUnique({ where: { id } });
        await db.auditLog.create({ data: { userId: session.userId, action: 'material_request_supervisor_reject', entityType: 'repair_material_request', entityId: id, newValues: JSON.stringify({ action: 'supervisor_reject', status: 'rejected', reason: notes || null }) } });
        await notifyUser(matReq.requestedById, 'repair_material_request', 'Material Request Rejected', `Your request for ${matReq.itemName} was rejected by supervisor${notes ? `: ${notes}` : ''}`, 'repair_material_request', id, `material-requests?id=${id}`);
        break;
      }

      case 'storekeeper_approve': {
        const qty = approvedQuantity ?? quantityApproved ?? matReq.quantityApproved;
        updated = await reserveMaterialRequest(id, session.userId, qty);
        await db.auditLog.create({ data: { userId: session.userId, action: 'material_request_storekeeper_approve', entityType: 'repair_material_request', entityId: id, newValues: JSON.stringify({ action: 'storekeeper_approve', status: 'storekeeper_approved', approvedQuantity: qty, previousApprovedQuantity: matReq.quantityApproved, quantityChanged: qty !== matReq.quantityApproved, stockReserved: updated.stockReserved, itemId: matReq.itemId || null }) } });
        await notifyUser(matReq.requestedById, 'repair_material_request', 'Material Request Ready for Issuance', `${qty} ${matReq.unit} of ${matReq.itemName} approved by store keeper. Ready for pickup.`, 'repair_material_request', id, `material-requests?id=${id}`);
        break;
      }

      case 'storekeeper_reject': {
        if (matReq.status !== 'supervisor_approved') return NextResponse.json({ success: false, error: `Cannot reject: current status is ${matReq.status}` }, { status: 400 });
        const rejectionNotes = notes ? `[${now.toISOString()}] REJECTED by store: ${notes}` : `[${now.toISOString()}] REJECTED by store keeper ${session.userId}`;
        const updatedNotes = matReq.notes ? `${matReq.notes}\n${rejectionNotes}` : rejectionNotes;
        const claim = await db.repairMaterialRequest.updateMany({ where: { id, status: 'supervisor_approved' }, data: { status: 'rejected', storekeeperApprovedById: session.userId, storekeeperApprovedAt: now, notes: updatedNotes } });
        if (claim.count !== 1) throw new MaterialCustodyConflictError('Store rejection was claimed concurrently');
        updated = await db.repairMaterialRequest.findUnique({ where: { id } });
        await db.auditLog.create({ data: { userId: session.userId, action: 'material_request_storekeeper_reject', entityType: 'repair_material_request', entityId: id, newValues: JSON.stringify({ action: 'storekeeper_reject', status: 'rejected', reason: notes || null }) } });
        await notifyUser(matReq.requestedById, 'repair_material_request', 'Material Request Rejected by Store', `Your request for ${matReq.itemName} was rejected by store keeper${notes ? `: ${notes}` : ''}`, 'repair_material_request', id, `material-requests?id=${id}`);
        break;
      }

      case 'issue': {
        const qtyToIssue = approvedQuantity ?? quantityApproved ?? matReq.quantityApproved;
        updated = await issueMaterialRequest(id, session.userId, qtyToIssue, notes);
        await db.auditLog.create({ data: { userId: session.userId, action: 'material_request_issue', entityType: 'repair_material_request', entityId: id, newValues: JSON.stringify({ action: 'issue', status: 'issued', quantityIssued: qtyToIssue, wasReserved: !!matReq.stockReserved, itemId: matReq.itemId || null }) } });
        await notifyUser(matReq.requestedById, 'repair_material_request', 'Materials Issued', `${qtyToIssue} ${matReq.unit} of ${matReq.itemName} issued for WO ${matReq.workOrder.woNumber}`, 'repair_material_request', id, `material-requests?id=${id}`);
        if (matReq.workOrder.plannerId && matReq.workOrder.plannerId !== matReq.requestedById) await notifyUser(matReq.workOrder.plannerId, 'repair_material_request', 'Material Issued for Planned Work Order', `${qtyToIssue} ${matReq.unit} of ${matReq.itemName} issued for WO ${matReq.workOrder.woNumber}`, 'repair_material_request', id, 'maintenance-work-orders');
        if (matReq.workOrder.assignedSupervisorId && matReq.workOrder.assignedSupervisorId !== matReq.requestedById && matReq.workOrder.assignedSupervisorId !== matReq.workOrder.plannerId) await notifyUser(matReq.workOrder.assignedSupervisorId, 'repair_material_request', 'Material Issued for WO Under Your Supervision', `${qtyToIssue} ${matReq.unit} of ${matReq.itemName} issued for WO ${matReq.workOrder.woNumber}`, 'repair_material_request', id, 'maintenance-work-orders');
        break;
      }

      case 'record_return': {
        const qtyToReturn = approvedQuantity ?? quantityApproved ?? quantityReturned ?? 0;
        if (!['serviceable', 'damaged', 'defective'].includes(returnCondition)) {
          return NextResponse.json({ success: false, error: 'Return condition is required' }, { status: 400 });
        }
        const result = await recordMaterialReturn(id, session.userId, qtyToReturn, { notes, condition: returnCondition });
        updated = result.updated;
        await db.auditLog.create({ data: { userId: session.userId, action: 'material_request_record_return', entityType: 'repair_material_request', entityId: id, newValues: JSON.stringify({ action: 'record_return', status: result.newStatus, returnQuantity: qtyToReturn, previousReturned: result.previousReturned, cumulativeReturned: result.cumulativeReturned, quantityIssued: matReq.quantityIssued, itemId: matReq.itemId || null, returnCondition: result.returnCondition, returnedToStock: result.returnedToStock, returnedToHold: result.returnedToHold, returnHoldId: result.returnHold?.id ?? null }) } });
        const destination = result.returnedToHold > 0 ? 'inspection hold' : 'usable store stock';
        await notifyUser(matReq.requestedById, 'repair_material_request', result.newStatus === 'fully_returned' ? 'All Materials Returned' : 'Partial Material Return Recorded', result.newStatus === 'fully_returned' ? `All ${matReq.quantityIssued} ${matReq.unit} of ${matReq.itemName} returned to ${destination} for WO ${matReq.workOrder.woNumber}` : `${qtyToReturn} ${matReq.unit} of ${matReq.itemName} returned to ${destination} for WO ${matReq.workOrder.woNumber}. Total returned: ${result.cumulativeReturned}/${matReq.quantityIssued}`, 'repair_material_request', id, `material-requests?id=${id}`);
        break;
      }

      case 'declare_usage': {
        if (!['issued', 'partially_returned', 'fully_returned'].includes(matReq.status)) {
          return NextResponse.json({ success: false, error: `Cannot declare usage: current status is ${matReq.status}` }, { status: 400 });
        }

        const declaredConsumed = Number(consumedQty);
        const declaredWasted = Number(wastedQty ?? 0);
        const declaredReturn = Number(returnQty);
        if (!Number.isFinite(declaredConsumed) || declaredConsumed < 0) {
          return NextResponse.json({ success: false, error: 'consumedQty must be a non-negative number' }, { status: 400 });
        }
        if (!Number.isFinite(declaredWasted) || declaredWasted < 0) {
          return NextResponse.json({ success: false, error: 'wastedQty must be a non-negative number' }, { status: 400 });
        }
        if (!Number.isFinite(declaredReturn) || declaredReturn < 0) {
          return NextResponse.json({ success: false, error: 'returnQty must be a non-negative number' }, { status: 400 });
        }

        const issued = Number(matReq.quantityIssued || 0);
        const accounted = declaredConsumed + declaredWasted + declaredReturn;
        if (Math.abs(accounted - issued) > 0.001) {
          return NextResponse.json({
            success: false,
            error: `Usage declaration must account for all issued material: used(${declaredConsumed}) + wasted(${declaredWasted}) + to return(${declaredReturn}) = ${accounted}, issued = ${issued}`,
          }, { status: 400 });
        }
        if (declaredReturn + 0.001 < (matReq.quantityReturned ?? 0)) {
          return NextResponse.json({
            success: false,
            error: `Declared return quantity (${declaredReturn}) cannot be less than material already physically returned (${matReq.quantityReturned ?? 0})`,
          }, { status: 400 });
        }

        const declarationClaim = await db.repairMaterialRequest.updateMany({
          where: { id, status: matReq.status, quantityIssued: matReq.quantityIssued },
          data: {
            declaredConsumedQty: declaredConsumed,
            declaredWastedQty: declaredWasted > 0 ? declaredWasted : null,
            declaredReturnQty: declaredReturn,
            usageDeclarationNotes: notes || null,
            usageDeclaredById: session.userId,
            usageDeclaredAt: now,
          },
        });
        if (declarationClaim.count !== 1) throw new MaterialCustodyConflictError('Material usage declaration changed concurrently');
        updated = await db.repairMaterialRequest.findUnique({ where: { id } });

        await db.auditLog.create({
          data: {
            userId: session.userId,
            action: 'material_request_usage_declared',
            entityType: 'repair_material_request',
            entityId: id,
            newValues: JSON.stringify({
              action: 'declare_usage',
              issuedQty: issued,
              declaredConsumedQty: declaredConsumed,
              declaredWastedQty: declaredWasted,
              declaredReturnQty: declaredReturn,
              notes: notes || null,
            }),
          },
        });

        const storeKeepers = matReq.plantId
          ? await db.user.findMany({
              where: {
                status: 'active',
                plantAccess: { some: { plantId: matReq.plantId } },
                userRoles: { some: { role: { slug: { in: [...RESOURCE_STORE_ROLE_SLUGS] } } } },
              },
              select: { id: true },
            })
          : [];
        for (const sk of storeKeepers) {
          if (sk.id === session.userId) continue;
          await notifyUser(
            sk.id,
            'repair_material_request',
            'Material Usage Declaration Awaiting Verification',
            `${matReq.itemName} for WO ${matReq.workOrder.woNumber}: ${declaredConsumed} used, ${declaredWasted} wasted, ${declaredReturn} to return. Verify the physical return and reconcile.`,
            'repair_material_request',
            id,
            `material-requests?id=${id}`,
          );
        }
        if (matReq.workOrder.assignedSupervisorId && matReq.workOrder.assignedSupervisorId !== session.userId) {
          await notifyUser(
            matReq.workOrder.assignedSupervisorId,
            'repair_material_request',
            'Material Usage Declared',
            `${matReq.itemName} for WO ${matReq.workOrder.woNumber}: ${declaredConsumed} used, ${declaredWasted} wasted, ${declaredReturn} to return.`,
            'repair_material_request',
            id,
            `material-requests?id=${id}`,
          );
        }
        break;
      }

      case 'consume_material': {
        const consumeQty = approvedQuantity ?? quantityApproved ?? 0;
        const previousConsumed = matReq.consumedQty ?? 0;
        updated = await recordMaterialConsumption(id, consumeQty);
        await db.auditLog.create({ data: { userId: session.userId, action: 'material_request_consume', entityType: 'repair_material_request', entityId: id, newValues: JSON.stringify({ action: 'consume_material', consumeQty, previousConsumed, newConsumed: updated.consumedQty, reconciliation: { consumed: updated.consumedQty ?? 0, wasted: updated.wastedQty ?? 0, returned: updated.quantityReturned ?? 0, issued: updated.quantityIssued } }) } });
        break;
      }

      case 'waste_material': {
        const wasteQty = approvedQuantity ?? quantityApproved ?? 0;
        const previousWasted = matReq.wastedQty ?? 0;
        updated = await recordMaterialWaste(id, wasteQty);
        await db.auditLog.create({ data: { userId: session.userId, action: 'material_request_waste', entityType: 'repair_material_request', entityId: id, newValues: JSON.stringify({ action: 'waste_material', wasteQty, previousWasted, newWasted: updated.wastedQty, reconciliation: { consumed: updated.consumedQty ?? 0, wasted: updated.wastedQty ?? 0, returned: updated.quantityReturned ?? 0, issued: updated.quantityIssued } }) } });
        break;
      }

      case 'reconcile': {
        if (!['issued', 'partially_returned', 'fully_returned'].includes(matReq.status)) return NextResponse.json({ success: false, error: `Cannot reconcile: current status is ${matReq.status}` }, { status: 400 });
        const consumed = matReq.consumedQty ?? 0;
        const wasted = matReq.wastedQty ?? 0;
        const returned = matReq.quantityReturned ?? 0;
        const total = consumed + wasted + returned;
        if (Math.abs(total - matReq.quantityIssued) > 0.001) return NextResponse.json({ success: false, error: `Reconciliation failed: consumed(${consumed}) + wasted(${wasted}) + returned(${returned}) = ${total} ≠ issued(${matReq.quantityIssued}). Difference: ${matReq.quantityIssued - total}` }, { status: 400 });
        const claim = await db.repairMaterialRequest.updateMany({
          where: { id, status: matReq.status, consumedQty: matReq.consumedQty, wastedQty: matReq.wastedQty, quantityReturned: matReq.quantityReturned },
          data: { status: 'closed' },
        });
        if (claim.count !== 1) throw new MaterialCustodyConflictError('Material reconciliation changed concurrently');
        updated = await db.repairMaterialRequest.findUnique({ where: { id } });
        await db.auditLog.create({ data: { userId: session.userId, action: 'material_request_reconcile', entityType: 'repair_material_request', entityId: id, newValues: JSON.stringify({ action: 'reconcile', status: 'closed', reconciliation: { consumed, wasted, returned, issued: matReq.quantityIssued } }) } });
        break;
      }

      default:
        return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to process action';
    if (error instanceof MaterialCustodyNotFoundError) return NextResponse.json({ success: false, error: message }, { status: 404 });
    if (error instanceof MaterialCustodyValidationError) return NextResponse.json({ success: false, error: message }, { status: 400 });
    if (error instanceof MaterialCustodyConflictError) return NextResponse.json({ success: false, error: message }, { status: 409 });
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
