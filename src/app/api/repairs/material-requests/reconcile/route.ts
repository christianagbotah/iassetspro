import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { notifyUser } from '@/lib/notifications';
import { authorizeMaterialRequestPlant } from '@/lib/plant-auth-helpers';
import { isResourceStoreActor } from '@/lib/resource-request-approval';
import {
  MaterialCustodyConflictError,
  MaterialCustodyNotFoundError,
  MaterialCustodyValidationError,
  reconcileMaterialRequest,
} from '@/services/materialCustody.service';

// POST /api/repairs/material-requests/reconcile
// Sets authoritative consumed/wasted quantities and credits only the incremental
// physical return delta. Exact replay is idempotent and creates no stock movement.
export async function POST(request: NextRequest) {
  try {
    const session = getSession(request);
    if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });

    if (!isResourceStoreActor(session, 'repair_material_requests.update')) {
      return NextResponse.json({
        success: false,
        error: 'Only admin, store keeper, inventory manager, or tools shop attendant can reconcile material requests',
      }, { status: 403 });
    }

    const body = await request.json();
    const { id, consumedQty, wastedQty, notes, returnCondition } = body;
    if (!id) return NextResponse.json({ success: false, error: 'Material request ID is required' }, { status: 400 });
    if (typeof consumedQty !== 'number' || consumedQty < 0) {
      return NextResponse.json({ success: false, error: 'consumedQty must be a non-negative number' }, { status: 400 });
    }
    if (wastedQty !== undefined && wastedQty !== null && (typeof wastedQty !== 'number' || wastedQty < 0)) {
      return NextResponse.json({ success: false, error: 'wastedQty must be a non-negative number' }, { status: 400 });
    }

    const plantAuth = await authorizeMaterialRequestPlant(request, session, id);
    if (!plantAuth.ok) return plantAuth.response;

    const resolvedWastedQty = wastedQty ?? 0;
    const declaration = await db.repairMaterialRequest.findUnique({
      where: { id },
      select: {
        declaredConsumedQty: true,
        declaredWastedQty: true,
        declaredReturnQty: true,
        usageDeclaredAt: true,
        usageDeclaredById: true,
        quantityIssued: true,
        quantityApproved: true,
        quantityReturned: true,
      },
    });
    if (!declaration) {
      return NextResponse.json({ success: false, error: 'Material request not found' }, { status: 404 });
    }

    const hasTechnicianDeclaration = !!declaration.usageDeclaredAt;
    const storeAdjustedDeclaration = hasTechnicianDeclaration && (
      Math.abs((declaration.declaredConsumedQty ?? 0) - consumedQty) > 0.001 ||
      Math.abs((declaration.declaredWastedQty ?? 0) - resolvedWastedQty) > 0.001
    );
    const normalizedNotes = typeof notes === 'string' ? notes.trim() : '';
    const issuedForCondition = Number(declaration.quantityIssued || declaration.quantityApproved || 0);
    const targetReturned = Math.max(0, issuedForCondition - consumedQty - resolvedWastedQty);
    const additionalReturn = Math.max(0, targetReturned - Number(declaration.quantityReturned || 0));
    const validReturnConditions = ['serviceable', 'damaged', 'defective'];
    if (additionalReturn > 0.001 && !validReturnConditions.includes(returnCondition)) {
      return NextResponse.json({
        success: false,
        error: 'Return condition is required when physical material is returned to store',
      }, { status: 400 });
    }
    if ((!hasTechnicianDeclaration || storeAdjustedDeclaration) && normalizedNotes.length < 5) {
      return NextResponse.json({
        success: false,
        error: !hasTechnicianDeclaration
          ? 'Technician usage declaration is missing. Document the reconciliation exception in Notes before continuing.'
          : 'Store figures differ from the technician declaration. Add a reconciliation note explaining the adjustment.',
      }, { status: 400 });
    }

    const result = await reconcileMaterialRequest(
      id, session.userId, consumedQty, resolvedWastedQty, normalizedNotes || undefined,
      additionalReturn > 0.001 ? returnCondition : 'serviceable',
    );
    const matReq = result.updated;
    const reconciliationRate = result.issuedQty > 0 ? (consumedQty / result.issuedQty) * 100 : 0;
    const wasteRate = result.issuedQty > 0 ? (resolvedWastedQty / result.issuedQty) * 100 : 0;

    if (!result.replay) {
      await db.auditLog.create({
        data: {
          userId: session.userId,
          action: 'material_request_reconcile',
          entityType: 'repair_material_request',
          entityId: id,
          newValues: JSON.stringify({
            action: 'reconcile',
            status: matReq.status,
            issuedQty: result.issuedQty,
            consumedQty,
            wastedQty: resolvedWastedQty,
            previousReturned: result.existingReturned,
            targetReturned: result.targetReturned,
            additionalReturnedToStock: result.additionalReturnedToStock,
            additionalReturnedToHold: result.additionalReturnedToHold,
            returnCondition: result.returnCondition,
            returnHoldId: result.returnHold?.id ?? null,
            reconciliationRate: `${reconciliationRate.toFixed(1)}%`,
            wasteRate: `${wasteRate.toFixed(1)}%`,
            itemId: matReq.itemId || null,
            technicianDeclaration: hasTechnicianDeclaration ? {
              declaredConsumedQty: declaration.declaredConsumedQty ?? 0,
              declaredWastedQty: declaration.declaredWastedQty ?? 0,
              declaredReturnQty: declaration.declaredReturnQty ?? 0,
              declaredById: declaration.usageDeclaredById,
              declaredAt: declaration.usageDeclaredAt,
            } : null,
            storeAdjustedDeclaration,
            reconciliationNotes: normalizedNotes || null,
          }),
        },
      });

      await notifyUser(
        matReq.requestedById,
        'repair_material_request',
        'Material Reconciliation Completed',
        `${matReq.itemName} for WO ${matReq.workOrder.woNumber}: ${consumedQty} consumed, ${resolvedWastedQty} wasted, ${result.targetReturned} returned.`,
        'repair_material_request',
        id,
        `material-requests?id=${id}`,
      );

      if (matReq.workOrder.plannerId && matReq.workOrder.plannerId !== matReq.requestedById) {
        await notifyUser(
          matReq.workOrder.plannerId,
          'repair_material_request',
          'Material Reconciliation Report',
          `${matReq.itemName} for WO ${matReq.workOrder.woNumber}: ${consumedQty} consumed, ${resolvedWastedQty} wasted, ${result.targetReturned} returned`,
          'repair_material_request',
          id,
          `material-requests?id=${id}`,
        );
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        materialRequest: matReq,
        reconciliation: {
          materialRequestId: id,
          itemName: matReq.itemName,
          woNumber: matReq.workOrder.woNumber,
          issuedQty: result.issuedQty,
          consumedQty,
          wastedQty: resolvedWastedQty,
          returnedQty: result.targetReturned,
          previousReturnedQty: result.existingReturned,
          additionalReturnedToStock: result.additionalReturnedToStock,
          additionalReturnedToHold: result.additionalReturnedToHold,
          returnCondition: result.returnCondition,
          returnHoldId: result.returnHold?.id ?? null,
          reconciliationRate: Number(reconciliationRate.toFixed(1)),
          wasteRate: Number(wasteRate.toFixed(1)),
          status: matReq.status,
          replay: result.replay,
        },
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to reconcile material request';
    if (error instanceof MaterialCustodyNotFoundError) return NextResponse.json({ success: false, error: message }, { status: 404 });
    if (error instanceof MaterialCustodyValidationError) return NextResponse.json({ success: false, error: message }, { status: 400 });
    if (error instanceof MaterialCustodyConflictError) return NextResponse.json({ success: false, error: message }, { status: 409 });
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
