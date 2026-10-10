/**
 * Tool Operations Service — concurrency-safe issue / return custody operations.
 */
import { db } from '@/lib/db';
import { checkToolCalibration } from '@/services/toolCalibration.service';
import { randomUUID } from 'node:crypto';

const VALID_CONDITIONS = ['new', 'good', 'fair', 'poor', 'damaged'];

export class ToolOperationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolOperationConflictError';
  }
}

export interface IssueItem {
  itemId: string;
  quantityIssued: number;
  issueNotes?: string;
}

export interface ReturnItem {
  itemId: string;
  quantityReturned: number;
  conditionAtReturn?: string;
  notes?: string;
}

export interface AtomicIssueResult {
  success: boolean;
  error?: string;
  conflict?: boolean;
  warnings?: string[];
  updatedRequest?: unknown;
}

export interface AtomicReturnResult {
  success: boolean;
  error?: string;
  conflict?: boolean;
  warnings?: string[];
  allReturned?: boolean;
  updatedRequest?: unknown;
}

export interface SubmitReturnResult {
  success: boolean;
  error?: string;
  conflict?: boolean;
  warnings?: string[];
  updatedRequest?: unknown;
}

const detailedInclude = {
  requestedBy: { select: { id: true, fullName: true, username: true } },
  supervisorApprovedBy: { select: { id: true, fullName: true } },
  storekeeperApprovedBy: { select: { id: true, fullName: true } },
  issuedByUser: { select: { id: true, fullName: true } },
  returnedByUser: { select: { id: true, fullName: true } },
  workOrder: { select: { id: true, woNumber: true, title: true, status: true, plantId: true, assignedSupervisorId: true, plannerId: true, assignedSupervisor: { select: { id: true, fullName: true } } } },
  tool: { select: { id: true, toolCode: true, name: true, status: true, category: true, condition: true, quantity: true, repairQuantity: true, assignedToId: true, checkedOutAt: true } },
  items: { include: { tool: { select: { id: true, toolCode: true, name: true, status: true, category: true, condition: true, quantity: true, repairQuantity: true, assignedToId: true, checkedOutAt: true } } }, orderBy: { createdAt: 'asc' as const } },
};

function isConflict(error: unknown): boolean {
  return error instanceof ToolOperationConflictError;
}

export async function atomicIssueTools(
  toolRequestId: string,
  session: { userId: string; fullName?: string },
  issuedItems: IssueItem[],
): Promise<AtomicIssueResult> {
  const warnings: string[] = [];
  const now = new Date();

  try {
    const updatedRequest = await db.$transaction(async (tx) => {
      const currentRequest = await tx.repairToolRequest.findUnique({
        where: { id: toolRequestId },
        select: { status: true },
      });
      if (!currentRequest) throw new Error('Tool request not found');
      if (!['storekeeper_approved', 'issued'].includes(currentRequest.status)) {
        throw new ToolOperationConflictError(`Cannot issue: status is ${currentRequest.status}`);
      }
      if (currentRequest.status === 'storekeeper_approved') {
        const claim = await tx.repairToolRequest.updateMany({
          where: { id: toolRequestId, status: 'storekeeper_approved' },
          data: { status: 'issued', issuedById: session.userId, issuedAt: now },
        });
        if (claim.count !== 1) throw new ToolOperationConflictError('Tool request issue state changed concurrently');
      }

      const toolReq = await tx.repairToolRequest.findUnique({
        where: { id: toolRequestId },
        include: { items: { include: { tool: true } }, tool: true, workOrder: { select: { woNumber: true, plannerId: true, plantId: true } }, requestedBy: { select: { id: true, fullName: true } } },
      });
      if (!toolReq) throw new Error('Tool request not found');
      if (currentRequest.status === 'issued' && toolReq.items.length === 0) {
        throw new ToolOperationConflictError('Single-tool request has already been issued');
      }

      let actualIssuedTotal = 0;

      if (toolReq.items.length > 0) {
        if (!Array.isArray(issuedItems) || issuedItems.length === 0) {
          throw new Error('issuedItems array is required for multi-tool requests');
        }

        for (const issuedItem of issuedItems) {
          const lineItem = toolReq.items.find((item) => item.id === issuedItem.itemId);
          if (!lineItem) {
            warnings.push(`Item ${issuedItem.itemId} not found in this request, skipping`);
            continue;
          }

          const approvedTotal = lineItem.quantityApproved ?? lineItem.quantityRequested;
          const alreadyIssued = lineItem.quantityIssued ?? 0;
          const remainingApproved = Math.max(0, approvedTotal - alreadyIssued);
          const qtyToIssue = Math.max(0, Math.min(
            Number.parseInt(String(issuedItem.quantityIssued), 10) || 0,
            remainingApproved,
          ));

          if (qtyToIssue === 0) {
            await tx.repairToolRequestItem.update({
              where: { id: lineItem.id },
              data: { availabilityStatus: 'unavailable', issueNotes: issuedItem.issueNotes || 'No quantity issued' },
            });
            continue;
          }

          if (!lineItem.toolId) {
            const nextIssued = alreadyIssued + qtyToIssue;
            const lineClaim = await tx.repairToolRequestItem.updateMany({
              where: { id: lineItem.id, quantityIssued: lineItem.quantityIssued },
              data: {
                quantityIssued: nextIssued,
                availabilityStatus: nextIssued >= approvedTotal ? 'available' : 'limited',
                issueNotes: issuedItem.issueNotes || null,
              },
            });
            if (lineClaim.count !== 1) throw new ToolOperationConflictError(`Issue quantity for "${lineItem.toolName}" changed concurrently`);
            actualIssuedTotal += qtyToIssue;
            continue;
          }

          const calCheck = await checkToolCalibration(lineItem.toolId);
          if (calCheck.blocked) {
            warnings.push(`"${lineItem.toolName}" BLOCKED: ${calCheck.reason || 'calibration issue'}. Item skipped.`);
            await tx.repairToolRequestItem.update({
              where: { id: lineItem.id },
              data: { availabilityStatus: 'unavailable', issueNotes: calCheck.reason || 'Blocked by calibration check' },
            });
            continue;
          }
          if (calCheck.reason) warnings.push(`"${lineItem.toolName}" WARNING: ${calCheck.reason}`);

          const tool = await tx.tool.findUnique({ where: { id: lineItem.toolId } });
          if (!tool) {
            warnings.push(`Tool "${lineItem.toolName}" not found`);
            continue;
          }
          if (tool.assignedToId && tool.assignedToId !== toolReq.requestedById) {
            throw new ToolOperationConflictError(`Tool "${lineItem.toolName}" is already assigned to another custodian`);
          }

          const actualIssued = Math.min(qtyToIssue, tool.quantity);
          if (actualIssued <= 0) {
            warnings.push(`"${lineItem.toolName}" is no longer available`);
            continue;
          }
          if (actualIssued < qtyToIssue) warnings.push(`"${lineItem.toolName}": only ${actualIssued} available`);

          const remaining = tool.quantity - actualIssued;
          const toolClaim = await tx.tool.updateMany({
            where: {
              id: lineItem.toolId,
              quantity: tool.quantity,
              status: tool.status,
              assignedToId: tool.assignedToId,
            },
            data: {
              quantity: { decrement: actualIssued },
              status: remaining <= 0 ? 'checked_out' : tool.status,
              ...(remaining <= 0 ? { assignedToId: toolReq.requestedById, checkedOutAt: now } : {}),
            },
          });
          if (toolClaim.count !== 1) {
            throw new ToolOperationConflictError(`Tool "${lineItem.toolName}" stock/custody changed concurrently`);
          }

          const nextIssued = alreadyIssued + actualIssued;
          await tx.toolTransaction.create({
            data: {
              toolId: lineItem.toolId,
              type: 'checkout',
              toUserId: toolReq.requestedById,
              notes: `Issued ${actualIssued}x for WO ${toolReq.workOrder.woNumber} (condition: ${tool.condition})${nextIssued < approvedTotal ? ' [PARTIAL]' : ''}`,
              performedById: session.userId,
              workOrderId: toolReq.workOrderId,
            },
          });
          const lineClaim = await tx.repairToolRequestItem.updateMany({
            where: { id: lineItem.id, quantityIssued: lineItem.quantityIssued },
            data: {
              quantityIssued: nextIssued,
              conditionAtIssue: tool.condition,
              availabilityStatus: nextIssued >= approvedTotal ? 'available' : 'limited',
              issueNotes: issuedItem.issueNotes || (actualIssued < qtyToIssue ? `Only ${actualIssued} available in stock` : null),
            },
          });
          if (lineClaim.count !== 1) throw new ToolOperationConflictError(`Issue quantity for "${lineItem.toolName}" changed concurrently`);
          actualIssuedTotal += actualIssued;
        }
      } else if (toolReq.toolId) {
        const tool = toolReq.tool;
        const calCheck = await checkToolCalibration(toolReq.toolId);
        if (calCheck.blocked) {
          warnings.push(`Tool '${tool?.name || toolReq.toolId}' BLOCKED: ${calCheck.reason || 'calibration issue'}. Single-tool issue skipped.`);
        } else {
          if (calCheck.reason) warnings.push(`Tool '${tool?.name || toolReq.toolId}' WARNING: ${calCheck.reason}`);
          if (!tool || tool.status !== 'available') {
            throw new ToolOperationConflictError(`Tool is not available for issue (current status: ${tool?.status})`);
          }
          if (tool.assignedToId && tool.assignedToId !== toolReq.requestedById) {
            throw new ToolOperationConflictError('Tool is already assigned to another custodian');
          }

          const conditionAtIssue = toolReq.toolConditionAtIssue || tool.condition;
          const toolClaim = await tx.tool.updateMany({
            where: { id: toolReq.toolId, status: tool.status, assignedToId: tool.assignedToId },
            data: { status: 'checked_out', assignedToId: toolReq.requestedById, checkedOutAt: now },
          });
          if (toolClaim.count !== 1) throw new ToolOperationConflictError('Tool custody changed concurrently');

          await tx.toolTransaction.create({
            data: {
              toolId: toolReq.toolId,
              type: 'checkout',
              toUserId: toolReq.requestedById,
              notes: `Issued for WO ${toolReq.workOrder.woNumber} (condition: ${conditionAtIssue})`,
              performedById: session.userId,
              workOrderId: toolReq.workOrderId,
            },
          });
          await tx.repairToolRequest.update({
            where: { id: toolRequestId },
            data: { toolConditionAtIssue: conditionAtIssue },
          });
          actualIssuedTotal = 1;
        }
      }

      if (actualIssuedTotal === 0 && currentRequest.status === 'storekeeper_approved') {
        await tx.repairToolRequest.update({
          where: { id: toolRequestId },
          data: { status: 'storekeeper_approved', issuedById: null, issuedAt: null },
        });
        warnings.push('No items were actually issued. Request status remains storekeeper_approved.');
      } else if (actualIssuedTotal === 0) {
        warnings.push('No additional items were issued. Existing issued custody remains unchanged.');
      }

      return tx.repairToolRequest.findUnique({ where: { id: toolRequestId }, include: detailedInclude });
    });

    return { success: true, warnings: warnings.length ? warnings : undefined, updatedRequest };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Atomic tool issue failed',
      conflict: isConflict(error),
    };
  }
}

export async function submitToolReturn(
  toolRequestId: string,
  session: { userId: string; fullName?: string },
  returnedItems: ReturnItem[],
  toolConditionAtReturn?: string,
): Promise<SubmitReturnResult> {
  const warnings: string[] = [];

  try {
    const updatedRequest = await db.$transaction(async (tx) => {
      const toolReq = await tx.repairToolRequest.findUnique({
        where: { id: toolRequestId },
        include: { items: true, tool: true },
      });
      if (!toolReq) throw new Error('Tool request not found');
      if (toolReq.status !== 'issued' && toolReq.status !== 'returned') {
        throw new ToolOperationConflictError(`Cannot return: status is ${toolReq.status}`);
      }

      if (toolReq.items.length > 0 && toolReq.status === 'returned') {
        const remaining = toolReq.items.some((item) => item.quantityIssued > item.quantityReturned + item.quantityTransferred);
        if (!remaining) throw new Error('All items have already been fully returned or transferred');
      }

      const requestClaim = await tx.repairToolRequest.updateMany({
        where: { id: toolRequestId, status: toolReq.status },
        data: { status: 'pending_return', returnedById: session.userId },
      });
      if (requestClaim.count !== 1) throw new ToolOperationConflictError('Tool return was submitted concurrently');

      if (toolReq.items.length > 0) {
        if (!Array.isArray(returnedItems) || returnedItems.length === 0) {
          throw new Error('returnedItems array is required for multi-tool requests');
        }
        let anyPending = false;

        for (const retItem of returnedItems) {
          const lineItem = toolReq.items.find((item) => item.id === retItem.itemId);
          if (!lineItem) {
            warnings.push(`Item ${retItem.itemId} not found in this request, skipping`);
            continue;
          }

          const existingPending = lineItem.pendingReturnQty ?? 0;
          const outstanding = Math.max(0, lineItem.quantityIssued - lineItem.quantityReturned - lineItem.quantityTransferred - existingPending);
          const requested = Number.parseInt(String(retItem.quantityReturned), 10) || 0;
          const qtyToReturn = Math.max(0, Math.min(requested, outstanding));
          if (qtyToReturn === 0) continue;

          const condition = VALID_CONDITIONS.includes(retItem.conditionAtReturn || '') ? retItem.conditionAtReturn! : 'good';
          const notes = typeof retItem.notes === 'string' ? retItem.notes.trim() : null;
          const itemClaim = await tx.repairToolRequestItem.updateMany({
            where: {
              id: lineItem.id,
              quantityIssued: lineItem.quantityIssued,
              quantityReturned: lineItem.quantityReturned,
              quantityTransferred: lineItem.quantityTransferred,
              pendingReturnQty: lineItem.pendingReturnQty,
            },
            data: {
              pendingReturnQty: existingPending + qtyToReturn,
              pendingReturnCondition: condition,
              pendingReturnNotes: notes || null,
            },
          });
          if (itemClaim.count !== 1) {
            throw new ToolOperationConflictError(`Return custody for "${lineItem.toolName}" changed concurrently`);
          }
          if (condition === 'poor' || condition === 'damaged') warnings.push(`"${lineItem.toolName}" reported in "${condition}" condition — store keeper will inspect`);
          anyPending = true;
        }

        if (!anyPending) throw new Error('No items to return');
      } else if (toolReq.toolId) {
        const condition = VALID_CONDITIONS.includes(toolConditionAtReturn || '')
          ? toolConditionAtReturn!
          : (toolReq.tool?.condition || 'good');
        await tx.repairToolRequest.update({ where: { id: toolRequestId }, data: { toolConditionAtReturn: condition } });
      } else {
        throw new Error('Tool request has no linked tool or line items');
      }

      return tx.repairToolRequest.findUnique({ where: { id: toolRequestId }, include: detailedInclude });
    });

    return { success: true, warnings: warnings.length ? warnings : undefined, updatedRequest };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Tool return submission failed',
      conflict: isConflict(error),
    };
  }
}

export async function atomicConfirmToolReturn(
  toolRequestId: string,
  session: { userId: string; fullName?: string },
): Promise<AtomicReturnResult> {
  const warnings: string[] = [];
  const now = new Date();

  try {
    const result = await db.$transaction(async (tx) => {
      const requestClaim = await tx.repairToolRequest.updateMany({
        where: { id: toolRequestId, status: 'pending_return' },
        data: { status: 'issued', returnConfirmedById: session.userId, returnConfirmedAt: now },
      });
      if (requestClaim.count !== 1) {
        const current = await tx.repairToolRequest.findUnique({ where: { id: toolRequestId }, select: { status: true } });
        if (!current) throw new Error('Tool request not found');
        throw new ToolOperationConflictError(`Cannot confirm return: status is ${current.status}`);
      }

      const toolReq = await tx.repairToolRequest.findUnique({
        where: { id: toolRequestId },
        include: { items: { include: { tool: true } }, tool: true, workOrder: { select: { woNumber: true, plannerId: true, plantId: true } }, requestedBy: { select: { id: true, fullName: true } } },
      });
      if (!toolReq) throw new Error('Tool request not found');

      let confirmedAny = false;
      if (toolReq.items.length > 0) {
        for (const item of toolReq.items) {
          const pendingQty = item.pendingReturnQty ?? 0;
          if (pendingQty <= 0) continue;

          const outstanding = item.quantityIssued - item.quantityReturned - item.quantityTransferred;
          if (pendingQty > outstanding) {
            throw new ToolOperationConflictError(`Pending return for "${item.toolName}" exceeds outstanding custody`);
          }
          const condition = VALID_CONDITIONS.includes(item.pendingReturnCondition || '') ? item.pendingReturnCondition! : 'good';

          if (item.toolId) {
            const tool = await tx.tool.findUnique({ where: { id: item.toolId } });
            if (!tool) throw new ToolOperationConflictError(`Tool "${item.toolName}" no longer exists`);
            if (tool.assignedToId && tool.assignedToId !== toolReq.requestedById) {
              throw new ToolOperationConflictError(`Tool "${item.toolName}" is assigned to a different custodian`);
            }
            const requiresRepair = condition === 'poor' || condition === 'damaged';
            const toolStatus = requiresRepair && tool.quantity <= 0 ? 'in_repair' : 'available';
            const toolClaim = await tx.tool.updateMany({
              where: { id: item.toolId, quantity: tool.quantity, status: tool.status, assignedToId: tool.assignedToId },
              data: requiresRepair
                ? {
                    repairQuantity: { increment: pendingQty },
                    status: toolStatus,
                    ...(tool.quantity <= 0 ? { condition } : {}),
                    assignedToId: null,
                    checkedOutAt: null,
                  }
                : {
                    quantity: { increment: pendingQty },
                    status: toolStatus,
                    condition,
                    assignedToId: null,
                    checkedOutAt: null,
                  },
            });
            if (toolClaim.count !== 1) throw new ToolOperationConflictError(`Tool "${item.toolName}" changed concurrently during return`);

            if (requiresRepair) {
              const existingDamageReport = await tx.damagedToolReport.findFirst({
                where: {
                  toolId: item.toolId,
                  workOrderId: toolReq.workOrderId,
                  reportedById: toolReq.requestedById,
                  status: { in: ['reported', 'assessed', 'repair_quoted', 'repair_in_progress'] },
                },
                orderBy: { createdAt: 'desc' },
              });

              if (existingDamageReport) {
                await tx.damagedToolReport.update({
                  where: { id: existingDamageReport.id },
                  data: {
                    toolRequestId: existingDamageReport.toolRequestId || toolRequestId,
                    quantity: Math.max(
                      existingDamageReport.quantity || 1,
                      (existingDamageReport.repairHeldQuantity || 0) + pendingQty,
                    ),
                    repairHeldQuantity: { increment: pendingQty },
                    damageDescription: item.pendingReturnNotes || existingDamageReport.damageDescription,
                  },
                });
              } else {
                await tx.damagedToolReport.create({
                  data: {
                    reportNumber: `DTR-AUTO-${now.getTime().toString(36).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`,
                    toolId: item.toolId,
                    workOrderId: toolReq.workOrderId,
                    toolRequestId: toolRequestId,
                    damageType: condition === 'damaged' ? 'broken' : 'worn',
                    damageSeverity: condition === 'damaged' ? 'high' : 'medium',
                    damageDescription: item.pendingReturnNotes || `Returned in ${condition} condition from WO ${toolReq.workOrder.woNumber}`,
                    quantity: pendingQty,
                    repairHeldQuantity: pendingQty,
                    reportedById: toolReq.requestedById,
                    technicianId: toolReq.requestedById,
                    plantId: toolReq.workOrder.plantId || tool.plantId || null,
                    status: 'reported',
                  },
                });
              }
            }

            await tx.toolTransaction.create({
              data: {
                toolId: item.toolId,
                type: 'return',
                fromUserId: toolReq.requestedById,
                notes: `Returned ${pendingQty}x from WO ${toolReq.workOrder.woNumber} (condition: ${condition})${item.pendingReturnNotes ? ` — ${item.pendingReturnNotes}` : ''}`,
                performedById: session.userId,
                workOrderId: toolReq.workOrderId,
              },
            });
          }

          const itemClaim = await tx.repairToolRequestItem.updateMany({
            where: {
              id: item.id,
              quantityIssued: item.quantityIssued,
              quantityReturned: item.quantityReturned,
              quantityTransferred: item.quantityTransferred,
              pendingReturnQty: item.pendingReturnQty,
            },
            data: {
              quantityReturned: { increment: pendingQty },
              conditionAtReturn: condition,
              pendingReturnQty: 0,
              pendingReturnCondition: null,
              pendingReturnNotes: null,
            },
          });
          if (itemClaim.count !== 1) throw new ToolOperationConflictError(`Return custody for "${item.toolName}" changed concurrently`);
          if (condition === 'poor' || condition === 'damaged') warnings.push(`"${item.toolName}" confirmed in "${condition}" condition — flagged for repair`);
          confirmedAny = true;
        }
      } else if (toolReq.toolId) {
        const condition = VALID_CONDITIONS.includes(toolReq.toolConditionAtReturn || '') ? toolReq.toolConditionAtReturn! : 'good';
        const tool = toolReq.tool;
        if (!tool) throw new ToolOperationConflictError('Tool no longer exists');
        if (tool.assignedToId && tool.assignedToId !== toolReq.requestedById) {
          throw new ToolOperationConflictError('Tool is assigned to a different custodian');
        }
        const toolStatus = condition === 'poor' || condition === 'damaged' ? 'in_repair' : 'available';
        const toolClaim = await tx.tool.updateMany({
          where: { id: toolReq.toolId, status: tool.status, assignedToId: tool.assignedToId },
          data: { status: toolStatus, assignedToId: null, checkedOutAt: null, condition },
        });
        if (toolClaim.count !== 1) throw new ToolOperationConflictError('Tool custody changed concurrently during return');

        await tx.toolTransaction.create({
          data: {
            toolId: toolReq.toolId,
            type: 'return',
            fromUserId: toolReq.requestedById,
            notes: `Returned from WO ${toolReq.workOrder.woNumber} (condition: ${condition})`,
            performedById: session.userId,
            workOrderId: toolReq.workOrderId,
          },
        });
        confirmedAny = true;
      }

      if (!confirmedAny) throw new ToolOperationConflictError('No pending tool return quantities were found');

      let allDone = true;
      if (toolReq.items.length > 0) {
        const refreshed = await tx.repairToolRequestItem.findMany({ where: { repairToolRequestId: toolRequestId } });
        allDone = refreshed.every((item) => item.quantityReturned + item.quantityTransferred >= item.quantityIssued && (item.pendingReturnQty ?? 0) === 0);
      }

      await tx.repairToolRequest.update({
        where: { id: toolRequestId },
        data: {
          status: allDone ? 'returned' : 'issued',
          ...(allDone ? { returnedAt: now } : {}),
        },
      });

      const updated = await tx.repairToolRequest.findUnique({ where: { id: toolRequestId }, include: detailedInclude });
      return { updated, allDone };
    });

    return {
      success: true,
      warnings: warnings.length ? warnings : undefined,
      allReturned: result.allDone,
      updatedRequest: result.updated,
    };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Atomic tool return confirmation failed',
      conflict: isConflict(error),
    };
  }
}
