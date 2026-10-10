import { db } from '@/lib/db';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const EPSILON = 0.001;
type Tx = Prisma.TransactionClient;

export class MaterialCustodyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MaterialCustodyConflictError';
  }
}

export class MaterialCustodyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MaterialCustodyValidationError';
  }
}

export class MaterialCustodyNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MaterialCustodyNotFoundError';
  }
}

const materialInclude = {
  workOrder: { select: { id: true, woNumber: true, title: true, plantId: true, plannerId: true, assignedSupervisorId: true } },
  requestedBy: { select: { id: true, fullName: true } },
  item: { select: { id: true, itemCode: true, name: true, currentStock: true, plantId: true } },
} satisfies Prisma.RepairMaterialRequestInclude;

export type MaterialReturnCondition = 'serviceable' | 'damaged' | 'defective';

type MaterialRequestWithContext = Prisma.RepairMaterialRequestGetPayload<{ include: typeof materialInclude }>;

function normalizeReturnCondition(value: string | null | undefined): MaterialReturnCondition {
  const normalized = (value || 'serviceable').trim().toLowerCase();
  if (!['serviceable', 'damaged', 'defective'].includes(normalized)) {
    throw new MaterialCustodyValidationError('Return condition must be serviceable, damaged, or defective');
  }
  return normalized as MaterialReturnCondition;
}

function requiresReturnQualityHold(condition: MaterialReturnCondition): boolean {
  return condition === 'damaged' || condition === 'defective';
}

async function createMaterialReturnQualityHold(
  tx: Tx,
  request: MaterialRequestWithContext,
  actorId: string,
  quantity: number,
  condition: MaterialReturnCondition,
  notes?: string | null,
) {
  const now = new Date();
  const returnNumber = `SPR-AUTO-${now.getTime().toString(36).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`;
  return tx.sparePartReturn.create({
    data: {
      returnNumber,
      workOrderId: request.workOrderId,
      componentId: request.componentRegistryId || null,
      materialRequestId: request.id,
      itemId: request.itemId || null,
      itemName: request.itemName,
      quantity,
      conditionOnReturn: condition,
      damageDescription: notes?.trim() || null,
      refurbishmentNeeded: true,
      plantId: request.workOrder.plantId || request.plantId || null,
      requestedById: request.requestedById || actorId,
      status: 'pending',
    },
  });
}

function positiveQuantity(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new MaterialCustodyValidationError(`${label} must be greater than 0`);
  }
  return value;
}


function assertMaterialPlantIntegrity(request: {
  plantId: string | null;
  workOrder: { plantId: string | null };
  item: { plantId: string } | null;
}) {
  const operationalPlantId = request.workOrder.plantId || request.plantId;
  if (request.plantId && request.workOrder.plantId && request.plantId !== request.workOrder.plantId) {
    throw new MaterialCustodyValidationError('Material request plant does not match its work order plant');
  }
  if (request.item && operationalPlantId && request.item.plantId !== operationalPlantId) {
    throw new MaterialCustodyValidationError('Inventory item belongs to a different plant');
  }
}

async function mutateInventory(
  tx: Tx,
  input: {
    itemId: string;
    delta: number;
    movementType: string;
    reason: string;
    referenceType: string;
    referenceId: string;
    actorId: string;
    notes?: string | null;
  },
) {
  const item = await tx.inventoryItem.findUnique({ where: { id: input.itemId } });
  if (!item) throw new MaterialCustodyNotFoundError('Linked inventory item not found');

  const newStock = item.currentStock + input.delta;
  if (newStock < -EPSILON) {
    throw new MaterialCustodyValidationError(`Insufficient stock. Available: ${item.currentStock}, Required: ${Math.abs(input.delta)}`);
  }

  const changed = await tx.inventoryItem.updateMany({
    where: { id: input.itemId, currentStock: item.currentStock },
    data: { currentStock: newStock },
  });
  if (changed.count !== 1) {
    throw new MaterialCustodyConflictError('Inventory stock changed concurrently');
  }

  await tx.stockMovement.create({
    data: {
      itemId: input.itemId,
      type: input.movementType,
      quantity: Math.abs(input.delta),
      previousStock: item.currentStock,
      newStock,
      reason: input.reason,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      performedById: input.actorId,
      notes: input.notes || null,
    },
  });

  return { previousStock: item.currentStock, newStock };
}

export async function reserveMaterialRequest(
  requestId: string,
  actorId: string,
  approvedQuantity: number,
) {
  const qty = positiveQuantity(approvedQuantity, 'Approved quantity');
  const now = new Date();

  return db.$transaction(async (tx) => {
    const request = await tx.repairMaterialRequest.findUnique({ where: { id: requestId }, include: materialInclude });
    if (!request) throw new MaterialCustodyNotFoundError('Material request not found');
    assertMaterialPlantIntegrity(request);
    if (request.status !== 'supervisor_approved') {
      throw new MaterialCustodyConflictError(`Cannot reserve: current status is ${request.status}`);
    }
    if (qty > request.quantityApproved + EPSILON) {
      throw new MaterialCustodyValidationError(`Store approval quantity (${qty}) exceeds supervisor-approved quantity (${request.quantityApproved})`);
    }

    const claim = await tx.repairMaterialRequest.updateMany({
      where: {
        id: requestId,
        status: 'supervisor_approved',
        quantityApproved: request.quantityApproved,
        stockReserved: request.stockReserved,
      },
      data: {
        status: 'storekeeper_approved',
        storekeeperApprovedById: actorId,
        storekeeperApprovedAt: now,
        storekeeperApprovedQuantity: qty !== request.quantityApproved ? qty : null,
        quantityApproved: qty,
        stockReserved: Boolean(request.itemId),
      },
    });
    if (claim.count !== 1) throw new MaterialCustodyConflictError('Material reservation was claimed concurrently');

    if (request.itemId) {
      await mutateInventory(tx, {
        itemId: request.itemId,
        delta: -qty,
        movementType: 'adjustment',
        reason: `Stock reserved for WO ${request.workOrder.woNumber} — ${request.itemName}`,
        referenceType: 'work_order',
        referenceId: request.workOrderId,
        actorId,
        notes: `Reservation: ${qty} ${request.unit} reserved for material request ${requestId.substring(0, 8)}`,
      });
    }

    return tx.repairMaterialRequest.findUniqueOrThrow({ where: { id: requestId }, include: materialInclude });
  });
}

export async function issueMaterialRequest(
  requestId: string,
  actorId: string,
  quantity: number,
  notes?: string | null,
) {
  const qty = positiveQuantity(quantity, 'Issue quantity');
  const now = new Date();

  return db.$transaction(async (tx) => {
    const request = await tx.repairMaterialRequest.findUnique({ where: { id: requestId }, include: materialInclude });
    if (!request) throw new MaterialCustodyNotFoundError('Material request not found');
    assertMaterialPlantIntegrity(request);
    if (!['storekeeper_approved', 'picking'].includes(request.status)) {
      throw new MaterialCustodyConflictError(`Cannot issue: current status is ${request.status}`);
    }
    if (qty > request.quantityApproved + EPSILON) {
      throw new MaterialCustodyValidationError(`Issue quantity (${qty}) exceeds approved quantity (${request.quantityApproved})`);
    }
    if (request.stockReserved && Math.abs(qty - request.quantityApproved) > EPSILON) {
      throw new MaterialCustodyValidationError('Reserved material must be issued at the full reserved quantity; adjust the reservation before issuing');
    }

    const claim = await tx.repairMaterialRequest.updateMany({
      where: {
        id: requestId,
        status: request.status,
        quantityIssued: request.quantityIssued,
        stockReserved: request.stockReserved,
      },
      data: { status: 'issued', quantityIssued: qty, issuedById: actorId, issuedAt: now },
    });
    if (claim.count !== 1) throw new MaterialCustodyConflictError('Material issue was claimed concurrently');

    if (request.itemId && !request.stockReserved) {
      await mutateInventory(tx, {
        itemId: request.itemId,
        delta: -qty,
        movementType: 'out',
        reason: `Issued for WO ${request.workOrder.woNumber}`,
        referenceType: 'work_order',
        referenceId: request.workOrderId,
        actorId,
        notes,
      });
    }

    return tx.repairMaterialRequest.findUniqueOrThrow({ where: { id: requestId }, include: materialInclude });
  });
}

export async function recordMaterialReturn(
  requestId: string,
  actorId: string,
  quantity: number,
  options: { notes?: string | null; creditInventory?: boolean; referenceType?: string; referenceId?: string; condition?: MaterialReturnCondition } = {},
) {
  const qty = positiveQuantity(quantity, 'Return quantity');
  const now = new Date();
  const returnCondition = normalizeReturnCondition(options.condition);
  const qualityHold = requiresReturnQualityHold(returnCondition);
  const creditInventory = options.creditInventory !== false && !qualityHold;

  return db.$transaction(async (tx) => {
    const request = await tx.repairMaterialRequest.findUnique({ where: { id: requestId }, include: materialInclude });
    if (!request) throw new MaterialCustodyNotFoundError('Material request not found');
    assertMaterialPlantIntegrity(request);
    if (!['issued', 'partially_returned'].includes(request.status)) {
      throw new MaterialCustodyConflictError(`Cannot record return: current status is ${request.status}`);
    }

    const consumed = request.consumedQty ?? 0;
    const wasted = request.wastedQty ?? 0;
    const previousReturned = request.quantityReturned ?? 0;
    const cumulativeReturned = previousReturned + qty;
    if (consumed + wasted + cumulativeReturned > request.quantityIssued + EPSILON) {
      throw new MaterialCustodyValidationError(
        `Return would exceed issued custody: consumed(${consumed}) + wasted(${wasted}) + returned(${cumulativeReturned}) > issued(${request.quantityIssued})`,
      );
    }
    const newStatus = cumulativeReturned >= request.quantityIssued - EPSILON ? 'fully_returned' : 'partially_returned';

    const claim = await tx.repairMaterialRequest.updateMany({
      where: {
        id: requestId,
        status: request.status,
        quantityReturned: request.quantityReturned,
        consumedQty: request.consumedQty,
        wastedQty: request.wastedQty,
      },
      data: {
        status: newStatus,
        quantityReturned: cumulativeReturned,
        returnedById: actorId,
        returnedAt: now,
      },
    });
    if (claim.count !== 1) throw new MaterialCustodyConflictError('Material custody changed concurrently');

    let returnHold: { id: string } | null = null;
    if (qualityHold) {
      returnHold = await createMaterialReturnQualityHold(tx, request, actorId, qty, returnCondition, options.notes);
    } else if (creditInventory && request.itemId) {
      await mutateInventory(tx, {
        itemId: request.itemId,
        delta: qty,
        movementType: 'in',
        reason: `Returned from WO ${request.workOrder.woNumber}`,
        referenceType: options.referenceType || 'work_order',
        referenceId: options.referenceId || request.workOrderId,
        actorId,
        notes: options.notes,
      });
    }

    const updated = await tx.repairMaterialRequest.findUniqueOrThrow({ where: { id: requestId }, include: materialInclude });
    return {
      updated, previousReturned, cumulativeReturned, newStatus, returnCondition, returnHold,
      returnedToStock: creditInventory && request.itemId ? qty : 0,
      returnedToHold: qualityHold ? qty : 0,
    };
  });
}

async function recordUsage(
  requestId: string,
  quantity: number,
  field: 'consumedQty' | 'wastedQty',
) {
  const qty = positiveQuantity(quantity, field === 'consumedQty' ? 'Consume quantity' : 'Waste quantity');

  return db.$transaction(async (tx) => {
    const request = await tx.repairMaterialRequest.findUnique({ where: { id: requestId }, include: materialInclude });
    if (!request) throw new MaterialCustodyNotFoundError('Material request not found');
    assertMaterialPlantIntegrity(request);
    if (!['issued', 'partially_returned'].includes(request.status)) {
      throw new MaterialCustodyConflictError(`Cannot update material usage: current status is ${request.status}`);
    }

    const consumed = request.consumedQty ?? 0;
    const wasted = request.wastedQty ?? 0;
    const returned = request.quantityReturned ?? 0;
    const nextConsumed = field === 'consumedQty' ? consumed + qty : consumed;
    const nextWasted = field === 'wastedQty' ? wasted + qty : wasted;
    if (nextConsumed + nextWasted + returned > request.quantityIssued + EPSILON) {
      throw new MaterialCustodyValidationError(
        `Reconciliation invariant violated: consumed(${nextConsumed}) + wasted(${nextWasted}) + returned(${returned}) exceeds issued(${request.quantityIssued})`,
      );
    }

    const claim = await tx.repairMaterialRequest.updateMany({
      where: {
        id: requestId,
        status: request.status,
        consumedQty: request.consumedQty,
        wastedQty: request.wastedQty,
        quantityReturned: request.quantityReturned,
      },
      data: { [field]: field === 'consumedQty' ? nextConsumed : nextWasted },
    });
    if (claim.count !== 1) throw new MaterialCustodyConflictError('Material reconciliation changed concurrently');

    return tx.repairMaterialRequest.findUniqueOrThrow({ where: { id: requestId }, include: materialInclude });
  });
}

export function recordMaterialConsumption(requestId: string, quantity: number) {
  return recordUsage(requestId, quantity, 'consumedQty');
}

export function recordMaterialWaste(requestId: string, quantity: number) {
  return recordUsage(requestId, quantity, 'wastedQty');
}

export async function reconcileMaterialRequest(
  requestId: string,
  actorId: string,
  consumedQty: number,
  wastedQty: number,
  notes?: string | null,
  returnConditionInput: MaterialReturnCondition = 'serviceable',
) {
  if (!Number.isFinite(consumedQty) || consumedQty < 0 || !Number.isFinite(wastedQty) || wastedQty < 0) {
    throw new MaterialCustodyValidationError('Consumed and wasted quantities must be non-negative numbers');
  }
  const now = new Date();
  const returnCondition = normalizeReturnCondition(returnConditionInput);
  const qualityHold = requiresReturnQualityHold(returnCondition);

  return db.$transaction(async (tx) => {
    const request = await tx.repairMaterialRequest.findUnique({ where: { id: requestId }, include: materialInclude });
    if (!request) throw new MaterialCustodyNotFoundError('Material request not found');
    assertMaterialPlantIntegrity(request);
    if (!['issued', 'picking', 'partially_returned', 'fully_returned', 'closed'].includes(request.status)) {
      throw new MaterialCustodyConflictError(`Cannot reconcile: current status is ${request.status}`);
    }

    const issued = request.quantityIssued || request.quantityApproved || 0;
    if (consumedQty + wastedQty > issued + EPSILON) {
      throw new MaterialCustodyValidationError(`Consumed (${consumedQty}) + wasted (${wastedQty}) exceeds issued quantity (${issued})`);
    }

    const existingReturned = request.quantityReturned ?? 0;
    const targetReturned = Math.max(0, issued - consumedQty - wastedQty);
    if (targetReturned + EPSILON < existingReturned) {
      throw new MaterialCustodyValidationError(
        `Reconciliation would reduce already returned quantity from ${existingReturned} to ${targetReturned}`,
      );
    }
    const additionalReturn = Math.max(0, targetReturned - existingReturned);
    const exactReplay = Math.abs((request.consumedQty ?? 0) - consumedQty) <= EPSILON &&
      Math.abs((request.wastedQty ?? 0) - wastedQty) <= EPSILON && additionalReturn <= EPSILON;

    if (request.status === 'closed' && exactReplay) {
      return {
        updated: request, issuedQty: issued, existingReturned, targetReturned, additionalReturn: 0, replay: true,
        returnCondition, returnHold: null, additionalReturnedToStock: 0, additionalReturnedToHold: 0,
      };
    }

    const total = consumedQty + wastedQty + targetReturned;
    const nextStatus = Math.abs(total - issued) <= EPSILON ? 'closed' : request.status;
    const noteLine = `[${now.toISOString()}] RECONCILIATION by ${actorId}: consumed=${consumedQty}, wasted=${wastedQty}, returned=${targetReturned}, additionalReturn=${additionalReturn}${notes ? ` — ${notes}` : ''}`;

    const claim = await tx.repairMaterialRequest.updateMany({
      where: {
        id: requestId,
        status: request.status,
        consumedQty: request.consumedQty,
        wastedQty: request.wastedQty,
        quantityReturned: request.quantityReturned,
      },
      data: {
        consumedQty,
        wastedQty: wastedQty > 0 ? wastedQty : null,
        quantityReturned: targetReturned,
        status: nextStatus,
        returnedById: additionalReturn > EPSILON ? actorId : request.returnedById,
        returnedAt: additionalReturn > EPSILON ? now : request.returnedAt,
        notes: request.notes ? `${request.notes}\n${noteLine}` : noteLine,
      },
    });
    if (claim.count !== 1) throw new MaterialCustodyConflictError('Material reconciliation changed concurrently');

    let returnHold: { id: string } | null = null;
    if (additionalReturn > EPSILON && qualityHold) {
      returnHold = await createMaterialReturnQualityHold(
        tx, request, actorId, additionalReturn, returnCondition,
        notes || `Reconciliation return: ${additionalReturn} ${request.unit}`,
      );
    } else if (additionalReturn > EPSILON && request.itemId) {
      await mutateInventory(tx, {
        itemId: request.itemId,
        delta: additionalReturn,
        movementType: 'in',
        reason: `Reconciliation return from WO ${request.workOrder.woNumber} — ${request.itemName}`,
        referenceType: 'work_order',
        referenceId: request.workOrderId,
        actorId,
        notes: `Reconciliation delta: ${additionalReturn} returned (${consumedQty} consumed, ${wastedQty} wasted)`,
      });
    }

    const updated = await tx.repairMaterialRequest.findUniqueOrThrow({ where: { id: requestId }, include: materialInclude });
    return {
      updated, issuedQty: issued, existingReturned, targetReturned, additionalReturn, replay: false,
      returnCondition, returnHold,
      additionalReturnedToStock: !qualityHold && request.itemId ? additionalReturn : 0,
      additionalReturnedToHold: qualityHold ? additionalReturn : 0,
    };
  });
}

export async function returnSparePartToStore(sparePartReturnId: string, actorId: string) {
  const now = new Date();
  return db.$transaction(async (tx) => {
    const record = await tx.sparePartReturn.findUnique({
      where: { id: sparePartReturnId },
      include: { workOrder: { select: { woNumber: true, plantId: true } }, item: true },
    });
    if (!record) throw new MaterialCustodyNotFoundError('Spare part return not found');
    if (record.plantId && record.workOrder?.plantId && record.plantId !== record.workOrder.plantId) {
      throw new MaterialCustodyValidationError('Spare part return plant does not match its work order plant');
    }
    const operationalPlantId = record.workOrder?.plantId || record.plantId;
    if (record.item && operationalPlantId && record.item.plantId !== operationalPlantId) {
      throw new MaterialCustodyValidationError('Spare part inventory item belongs to a different plant');
    }
    const returnQuantity = positiveQuantity(record.quantity, 'Spare part quantity');
    const readyWithoutRefurbishment = record.status === 'inspected' && !record.refurbishmentNeeded;
    const readyAfterRefurbishment = record.status === 'refurbished';
    if (!readyWithoutRefurbishment && !readyAfterRefurbishment) {
      throw new MaterialCustodyConflictError(
        `Cannot return to store: current status is '${record.status}'${record.status === 'inspected' && record.refurbishmentNeeded ? ' and refurbishment is still required' : ''}`,
      );
    }

    const claim = await tx.sparePartReturn.updateMany({
      where: {
        id: sparePartReturnId,
        status: record.status,
        refurbishmentNeeded: record.refurbishmentNeeded,
        returnedToStoreAt: null,
      },
      data: { status: 'returned_to_store', returnedToStoreById: actorId, returnedToStoreAt: now },
    });
    if (claim.count !== 1) throw new MaterialCustodyConflictError('Spare part return was claimed concurrently');

    if (record.installedSparePartId) {
      const installedClaim = await tx.installedSparePart.updateMany({
        where: { id: record.installedSparePartId, status: 'removed' },
        data: { status: 'returned_to_store' },
      });
      if (installedClaim.count !== 1) throw new MaterialCustodyConflictError('Installed spare custody changed concurrently');
    }

    if (record.itemId) {
      await mutateInventory(tx, {
        itemId: record.itemId,
        delta: returnQuantity,
        movementType: 'in',
        reason: `Spare part return ${record.returnNumber} - returned to store`,
        referenceType: 'return',
        referenceId: record.id,
        actorId,
        notes: `WO: ${record.workOrder?.woNumber || 'N/A'}`,
      });
    }

    return tx.sparePartReturn.findUniqueOrThrow({
      where: { id: sparePartReturnId },
      include: {
        workOrder: { select: { id: true, woNumber: true, title: true } },
        item: { select: { id: true, itemCode: true, name: true, currentStock: true } },
        returnedToStore: { select: { id: true, fullName: true } },
      },
    });
  });
}

type CreateSparePartReturnInput = {
  returnNumber: string;
  workOrderId: string;
  componentId?: string | null;
  materialRequestId?: string | null;
  installedSparePartId?: string | null;
  removalReason?: string | null;
  itemId?: string | null;
  itemName: string;
  partSerialNumber?: string | null;
  quantity: number;
  conditionOnReturn?: string | null;
  damageDescription?: string | null;
  refurbishmentNeeded: boolean;
  refurbishmentNotes?: string | null;
  estimatedRefurbCost?: number | null;
  plantId?: string | null;
  requestedById: string;
  isConsumed: boolean;
};

export async function createSparePartReturnWithCustody(input: CreateSparePartReturnInput) {
  const qty = positiveQuantity(input.quantity, 'Spare part quantity');
  const now = new Date();

  return db.$transaction(async (tx) => {
    if (input.installedSparePartId && input.materialRequestId) {
      throw new MaterialCustodyValidationError('A removed installed spare cannot also be re-accounted against material request custody');
    }
    let materialAccounting: Record<string, unknown> | null = null;
    let authoritativeItemId = input.itemId || null;
    let authoritativeComponentId = input.componentId || null;
    let authoritativeItemName = input.itemName;
    let authoritativeSerialNumber = input.partSerialNumber || null;

    if (input.installedSparePartId) {
      const installedPart = await tx.installedSparePart.findUnique({
        where: { id: input.installedSparePartId },
        include: {
          component: { select: { id: true, assetId: true, asset: { select: { plantId: true } } } },
          inventoryItem: { select: { id: true, name: true, itemCode: true, plantId: true } },
        },
      });
      if (!installedPart) throw new MaterialCustodyNotFoundError('Installed spare part not found');
      if (!['installed', 'removed'].includes(installedPart.status)) {
        throw new MaterialCustodyConflictError(`Installed spare part cannot enter return custody from status '${installedPart.status}'`);
      }
      if (installedPart.status === 'installed' && !input.removalReason?.trim()) {
        throw new MaterialCustodyValidationError('Removal reason is required when removing an installed spare part');
      }
      if (input.componentId && input.componentId !== installedPart.componentId) {
        throw new MaterialCustodyValidationError('Installed spare part belongs to a different component');
      }
      if (input.itemId && installedPart.inventoryItemId && input.itemId !== installedPart.inventoryItemId) {
        throw new MaterialCustodyValidationError('Installed spare part references a different inventory item');
      }
      if (input.plantId && installedPart.component.asset?.plantId && input.plantId !== installedPart.component.asset.plantId) {
        throw new MaterialCustodyValidationError('Installed spare part belongs to a different plant');
      }
      if (Math.abs(qty - installedPart.quantity) > EPSILON) {
        throw new MaterialCustodyValidationError(`Return quantity (${qty}) must match the removed installed quantity (${installedPart.quantity})`);
      }
      const existingReturn = await tx.sparePartReturn.findUnique({
        where: { installedSparePartId: installedPart.id },
        select: { id: true, returnNumber: true },
      });
      if (existingReturn) {
        throw new MaterialCustodyConflictError(`Installed spare part is already linked to return ${existingReturn.returnNumber}`);
      }
      authoritativeItemId = installedPart.inventoryItemId || authoritativeItemId;
      authoritativeComponentId = installedPart.componentId;
      authoritativeItemName = installedPart.partName;
      authoritativeSerialNumber = installedPart.serialNumber || authoritativeSerialNumber;

      if (installedPart.status === 'installed') {
        const removalClaim = await tx.installedSparePart.updateMany({
          where: { id: input.installedSparePartId, status: 'installed' },
          data: {
            status: 'removed',
            removedAt: now,
            removedById: input.requestedById,
            removalReason: input.removalReason!.trim(),
            conditionOnRemoval: input.conditionOnReturn || null,
          },
        });
        if (removalClaim.count !== 1) throw new MaterialCustodyConflictError('Installed spare removal was claimed concurrently');
      }
    }

    if (input.materialRequestId) {
      const material = await tx.repairMaterialRequest.findUnique({ where: { id: input.materialRequestId } });
      if (!material) throw new MaterialCustodyNotFoundError('Linked material request not found');
      if (material.workOrderId !== input.workOrderId) {
        throw new MaterialCustodyValidationError('Linked material request belongs to a different work order');
      }
      if (input.plantId && material.plantId && input.plantId !== material.plantId) {
        throw new MaterialCustodyValidationError('Linked material request belongs to a different plant');
      }
      if (input.itemId && material.itemId && input.itemId !== material.itemId) {
        throw new MaterialCustodyValidationError('Linked material request references a different inventory item');
      }
      if (input.componentId && material.componentRegistryId && input.componentId !== material.componentRegistryId) {
        throw new MaterialCustodyValidationError('Linked material request references a different component');
      }
      authoritativeItemId = material.itemId || input.itemId || null;
      authoritativeComponentId = material.componentRegistryId || input.componentId || null;

      if (!['issued', 'partially_returned'].includes(material.status)) {
        throw new MaterialCustodyConflictError(`Cannot account spare part against material request in status '${material.status}'`);
      }

      const consumed = material.consumedQty ?? 0;
      const wasted = material.wastedQty ?? 0;
      const returned = material.quantityReturned ?? 0;
      const issued = material.quantityIssued || material.quantityApproved || 0;

      if (input.isConsumed) {
        const nextConsumed = consumed + qty;
        if (nextConsumed + wasted + returned > issued + EPSILON) {
          throw new MaterialCustodyValidationError('Consumed spare part quantity exceeds outstanding issued custody');
        }
        const fullyAccounted = Math.abs(nextConsumed + wasted + returned - issued) <= EPSILON;
        const claim = await tx.repairMaterialRequest.updateMany({
          where: {
            id: material.id,
            status: material.status,
            consumedQty: material.consumedQty,
            wastedQty: material.wastedQty,
            quantityReturned: material.quantityReturned,
          },
          data: {
            consumedQty: nextConsumed,
            status: fullyAccounted ? 'closed' : material.status,
          },
        });
        if (claim.count !== 1) throw new MaterialCustodyConflictError('Material custody changed concurrently');
        materialAccounting = {
          action: 'consumed_via_spare_return',
          previousConsumed: consumed,
          consumedQty: nextConsumed,
          quantityReturned: returned,
          status: fullyAccounted ? 'closed' : material.status,
        };
      } else {
        const nextReturned = returned + qty;
        if (consumed + wasted + nextReturned > issued + EPSILON) {
          throw new MaterialCustodyValidationError('Reusable spare return quantity exceeds outstanding issued custody');
        }
        const nextStatus = Math.abs(consumed + wasted + nextReturned - issued) <= EPSILON ? 'fully_returned' : 'partially_returned';
        const claim = await tx.repairMaterialRequest.updateMany({
          where: {
            id: material.id,
            status: material.status,
            consumedQty: material.consumedQty,
            wastedQty: material.wastedQty,
            quantityReturned: material.quantityReturned,
          },
          data: {
            quantityReturned: nextReturned,
            status: nextStatus,
            returnedById: input.requestedById,
            returnedAt: now,
          },
        });
        if (claim.count !== 1) throw new MaterialCustodyConflictError('Material custody changed concurrently');
        materialAccounting = {
          action: 'returned_via_spare_return',
          previousReturned: returned,
          quantityReturned: nextReturned,
          status: nextStatus,
        };
      }
    }

    const sparePartReturn = await tx.sparePartReturn.create({
      data: {
        returnNumber: input.returnNumber,
        workOrderId: input.workOrderId,
        componentId: authoritativeComponentId,
        materialRequestId: input.materialRequestId || null,
        installedSparePartId: input.installedSparePartId || null,
        itemId: authoritativeItemId,
        itemName: authoritativeItemName,
        partSerialNumber: authoritativeSerialNumber,
        quantity: qty,
        conditionOnReturn: input.conditionOnReturn || 'used',
        damageDescription: input.damageDescription || null,
        refurbishmentNeeded: input.refurbishmentNeeded && !input.isConsumed,
        refurbishmentNotes: input.refurbishmentNotes || null,
        estimatedRefurbCost: input.estimatedRefurbCost ?? null,
        plantId: input.plantId || null,
        requestedById: input.requestedById,
        status: input.isConsumed ? 'disposed' : 'pending',
        ...(input.isConsumed ? {
          disposedById: input.requestedById,
          disposedAt: now,
          disposalReason: 'Consumed during repair',
        } : {}),
      },
      include: {
        workOrder: { select: { id: true, woNumber: true, title: true } },
        component: { select: { id: true, componentCode: true, name: true, criticality: true, assetId: true } },
        item: { select: { id: true, itemCode: true, name: true } },
        requestedBy: { select: { id: true, fullName: true, username: true } },
      },
    });

    if (input.installedSparePartId && input.isConsumed) {
      const installedClaim = await tx.installedSparePart.updateMany({
        where: { id: input.installedSparePartId, status: 'removed' },
        data: { status: 'scrapped' },
      });
      if (installedClaim.count !== 1) throw new MaterialCustodyConflictError('Installed spare custody changed concurrently');
    }

    return { sparePartReturn, materialAccounting };
  });
}
