import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db, tx } = vi.hoisted(() => {
  const tx = {
    repairMaterialRequest: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      updateMany: vi.fn(),
    },
    inventoryItem: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    stockMovement: { create: vi.fn() },
    sparePartReturn: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    installedSparePart: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  return {
    tx,
    db: {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    },
  };
});

vi.mock('@/lib/db', () => ({ db }));

import {
  createSparePartReturnWithCustody,
  issueMaterialRequest,
  MaterialCustodyConflictError,
  MaterialCustodyValidationError,
  reconcileMaterialRequest,
  recordMaterialConsumption,
  recordMaterialReturn,
  reserveMaterialRequest,
  returnSparePartToStore,
} from '../materialCustody.service';

function material(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mat-1', workOrderId: 'wo-1', plantId: 'plant-1', itemId: 'inv-1', itemName: 'Bearing', unit: 'pcs',
    status: 'issued', quantityRequested: 10, quantityApproved: 10, quantityIssued: 10, quantityReturned: 0,
    consumedQty: null, wastedQty: null, stockReserved: false, notes: null, returnedById: null, returnedAt: null,
    requestedById: 'tech-1', workOrder: { id: 'wo-1', woNumber: 'WO-1', title: 'Repair', plantId: 'plant-1', plannerId: 'p-1', assignedSupervisorId: 's-1' },
    requestedBy: { id: 'tech-1', fullName: 'Tech' }, item: { id: 'inv-1', itemCode: 'B-1', name: 'Bearing', currentStock: 20, plantId: 'plant-1' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  tx.repairMaterialRequest.updateMany.mockResolvedValue({ count: 1 });
  tx.inventoryItem.updateMany.mockResolvedValue({ count: 1 });
  tx.sparePartReturn.updateMany.mockResolvedValue({ count: 1 });
  tx.installedSparePart.updateMany.mockResolvedValue({ count: 1 });
  tx.stockMovement.create.mockResolvedValue({});
});

describe('material custody CAS', () => {
  it('reserves stock once and writes one matching ledger movement', async () => {
    const req = material({ status: 'supervisor_approved', quantityApproved: 6, quantityIssued: 0 });
    tx.repairMaterialRequest.findUnique.mockResolvedValue(req);
    tx.inventoryItem.findUnique.mockResolvedValue({ id: 'inv-1', currentStock: 8 });
    tx.repairMaterialRequest.findUniqueOrThrow.mockResolvedValue({ ...req, status: 'storekeeper_approved', stockReserved: true });

    await reserveMaterialRequest('mat-1', 'store-1', 6);

    expect(tx.inventoryItem.updateMany).toHaveBeenCalledWith({
      where: { id: 'inv-1', currentStock: 8 }, data: { currentStock: 2 },
    });
    expect(tx.stockMovement.create).toHaveBeenCalledTimes(1);
    expect(tx.stockMovement.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ previousStock: 8, newStock: 2, quantity: 6 }) }));
  });

  it('does not allow store approval above the supervisor-approved quantity', async () => {
    tx.repairMaterialRequest.findUnique.mockResolvedValue(material({ status: 'supervisor_approved', quantityApproved: 4, quantityIssued: 0 }));

    await expect(reserveMaterialRequest('mat-1', 'store-1', 5)).rejects.toBeInstanceOf(MaterialCustodyValidationError);
    expect(tx.repairMaterialRequest.updateMany).not.toHaveBeenCalled();
    expect(tx.inventoryItem.updateMany).not.toHaveBeenCalled();
  });

  it('does not touch stock when duplicate reservation loses the request CAS', async () => {
    tx.repairMaterialRequest.findUnique.mockResolvedValue(material({ status: 'supervisor_approved', quantityIssued: 0 }));
    tx.repairMaterialRequest.updateMany.mockResolvedValue({ count: 0 });

    await expect(reserveMaterialRequest('mat-1', 'store-1', 5)).rejects.toBeInstanceOf(MaterialCustodyConflictError);
    expect(tx.inventoryItem.updateMany).not.toHaveBeenCalled();
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });

  it('issues reserved stock without a second stock mutation or fake movement', async () => {
    const req = material({ status: 'storekeeper_approved', stockReserved: true, quantityIssued: 0 });
    tx.repairMaterialRequest.findUnique.mockResolvedValue(req);
    tx.repairMaterialRequest.findUniqueOrThrow.mockResolvedValue({ ...req, status: 'issued', quantityIssued: 10 });

    await issueMaterialRequest('mat-1', 'store-1', 10);

    expect(tx.inventoryItem.updateMany).not.toHaveBeenCalled();
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });

  it('does not allow a partial issue to orphan previously reserved stock', async () => {
    tx.repairMaterialRequest.findUnique.mockResolvedValue(material({ status: 'storekeeper_approved', stockReserved: true, quantityApproved: 10, quantityIssued: 0 }));

    await expect(issueMaterialRequest('mat-1', 'store-1', 8)).rejects.toBeInstanceOf(MaterialCustodyValidationError);
    expect(tx.repairMaterialRequest.updateMany).not.toHaveBeenCalled();
    expect(tx.inventoryItem.updateMany).not.toHaveBeenCalled();
  });

  it('issues unreserved stock with exact observed-stock CAS', async () => {
    const req = material({ status: 'storekeeper_approved', stockReserved: false, quantityIssued: 0, quantityApproved: 4 });
    tx.repairMaterialRequest.findUnique.mockResolvedValue(req);
    tx.inventoryItem.findUnique.mockResolvedValue({ id: 'inv-1', currentStock: 5 });
    tx.repairMaterialRequest.findUniqueOrThrow.mockResolvedValue({ ...req, status: 'issued', quantityIssued: 4 });

    await issueMaterialRequest('mat-1', 'store-1', 4);

    expect(tx.inventoryItem.updateMany).toHaveBeenCalledWith({ where: { id: 'inv-1', currentStock: 5 }, data: { currentStock: 1 } });
    expect(tx.stockMovement.create).toHaveBeenCalledTimes(1);
  });

  it('prevents duplicate/concurrent return credit when custody CAS loses', async () => {
    tx.repairMaterialRequest.findUnique.mockResolvedValue(material());
    tx.repairMaterialRequest.updateMany.mockResolvedValue({ count: 0 });

    await expect(recordMaterialReturn('mat-1', 'store-1', 2)).rejects.toBeInstanceOf(MaterialCustodyConflictError);
    expect(tx.inventoryItem.updateMany).not.toHaveBeenCalled();
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });

  it('enforces consumed+wasted+returned <= issued', async () => {
    tx.repairMaterialRequest.findUnique.mockResolvedValue(material({ quantityIssued: 10, consumedQty: 7, wastedQty: 1, quantityReturned: 1 }));
    await expect(recordMaterialReturn('mat-1', 'store-1', 2)).rejects.toBeInstanceOf(MaterialCustodyValidationError);
    expect(tx.repairMaterialRequest.updateMany).not.toHaveBeenCalled();
  });

  it('quarantines a damaged direct material return instead of restocking it', async () => {
    const req = material();
    tx.repairMaterialRequest.findUnique.mockResolvedValue(req);
    tx.sparePartReturn.create.mockResolvedValue({ id: 'hold-direct', status: 'pending', conditionOnReturn: 'defective' });
    tx.repairMaterialRequest.findUniqueOrThrow.mockResolvedValue({ ...req, quantityReturned: 2, status: 'partially_returned' });

    const result = await recordMaterialReturn('mat-1', 'store-1', 2, {
      notes: 'Failed visual inspection',
      condition: 'defective',
    });

    expect(result.returnedToStock).toBe(0);
    expect(result.returnedToHold).toBe(2);
    expect(tx.inventoryItem.updateMany).not.toHaveBeenCalled();
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
    expect(tx.sparePartReturn.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        materialRequestId: 'mat-1',
        quantity: 2,
        conditionOnReturn: 'defective',
        refurbishmentNeeded: true,
      }),
    }));
  });

  it('turns a stale consumption write into a conflict', async () => {
    tx.repairMaterialRequest.findUnique.mockResolvedValue(material({ consumedQty: 2 }));
    tx.repairMaterialRequest.updateMany.mockResolvedValue({ count: 0 });
    await expect(recordMaterialConsumption('mat-1', 1)).rejects.toBeInstanceOf(MaterialCustodyConflictError);
  });
});

describe('material reconciliation delta', () => {
  it('credits only the incremental return delta', async () => {
    const req = material({ quantityIssued: 10, consumedQty: 3, wastedQty: 1, quantityReturned: 2 });
    tx.repairMaterialRequest.findUnique.mockResolvedValue(req);
    tx.inventoryItem.findUnique.mockResolvedValue({ id: 'inv-1', currentStock: 20 });
    tx.repairMaterialRequest.findUniqueOrThrow.mockResolvedValue({ ...req, consumedQty: 4, wastedQty: 1, quantityReturned: 5, status: 'closed' });

    const result = await reconcileMaterialRequest('mat-1', 'store-1', 4, 1);

    expect(result.additionalReturn).toBe(3);
    expect(tx.inventoryItem.updateMany).toHaveBeenCalledWith({ where: { id: 'inv-1', currentStock: 20 }, data: { currentStock: 23 } });
    expect(tx.stockMovement.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ quantity: 3, previousStock: 20, newStock: 23 }) }));
  });

  it('quarantines a damaged reconciliation return instead of crediting usable inventory', async () => {
    const req = material({ quantityIssued: 10, consumedQty: 3, wastedQty: 1, quantityReturned: 2 });
    tx.repairMaterialRequest.findUnique.mockResolvedValue(req);
    tx.sparePartReturn.create.mockResolvedValue({ id: 'hold-1', status: 'pending', conditionOnReturn: 'damaged' });
    tx.repairMaterialRequest.findUniqueOrThrow.mockResolvedValue({ ...req, consumedQty: 4, wastedQty: 1, quantityReturned: 5, status: 'closed' });

    const result = await reconcileMaterialRequest('mat-1', 'store-1', 4, 1, 'Housing cracked on return', 'damaged');

    expect(result.additionalReturn).toBe(3);
    expect(result.additionalReturnedToStock).toBe(0);
    expect(result.additionalReturnedToHold).toBe(3);
    expect(tx.inventoryItem.updateMany).not.toHaveBeenCalled();
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
    expect(tx.sparePartReturn.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        materialRequestId: 'mat-1',
        itemId: 'inv-1',
        workOrderId: 'wo-1',
        plantId: 'plant-1',
        itemName: 'Bearing',
        quantity: 3,
        conditionOnReturn: 'damaged',
        status: 'pending',
        refurbishmentNeeded: true,
      }),
    }));
  });

  it('makes exact closed reconciliation replay a no-op', async () => {
    const req = material({ status: 'closed', quantityIssued: 10, consumedQty: 4, wastedQty: 1, quantityReturned: 5 });
    tx.repairMaterialRequest.findUnique.mockResolvedValue(req);

    const result = await reconcileMaterialRequest('mat-1', 'store-1', 4, 1);

    expect(result.replay).toBe(true);
    expect(result.additionalReturn).toBe(0);
    expect(tx.repairMaterialRequest.updateMany).not.toHaveBeenCalled();
    expect(tx.inventoryItem.updateMany).not.toHaveBeenCalled();
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });

  it('rejects retroactive reduction of already physically returned stock', async () => {
    tx.repairMaterialRequest.findUnique.mockResolvedValue(material({ quantityIssued: 10, consumedQty: 2, wastedQty: 0, quantityReturned: 6 }));
    await expect(reconcileMaterialRequest('mat-1', 'store-1', 5, 0)).rejects.toBeInstanceOf(MaterialCustodyValidationError);
  });
});

describe('spare-part custody accounting', () => {
  it('atomically removes an installed spare when opening return custody', async () => {
    tx.installedSparePart.findUnique.mockResolvedValue({
      id: 'installed-live', componentId: 'component-1', inventoryItemId: 'inv-1', partName: 'Gearbox',
      serialNumber: 'GBX-01', quantity: 1, status: 'installed', removedAt: null,
      component: { id: 'component-1', assetId: 'asset-1', asset: { plantId: 'plant-1' } },
      inventoryItem: { id: 'inv-1', name: 'Gearbox', itemCode: 'GBX', plantId: 'plant-1' },
    });
    tx.sparePartReturn.findUnique.mockResolvedValue(null);
    tx.sparePartReturn.create.mockResolvedValue({ id: 'spr-live', status: 'pending', installedSparePartId: 'installed-live' });

    await createSparePartReturnWithCustody({
      returnNumber: 'SPR-LIVE', workOrderId: 'wo-2', installedSparePartId: 'installed-live',
      itemName: 'ignored', quantity: 1, plantId: 'plant-1', requestedById: 'tech-1',
      refurbishmentNeeded: true, isConsumed: false, removalReason: 'Bearing seizure', conditionOnReturn: 'damaged',
    });

    expect(tx.installedSparePart.updateMany).toHaveBeenCalledWith({
      where: { id: 'installed-live', status: 'installed' },
      data: expect.objectContaining({
        status: 'removed', removedById: 'tech-1', removalReason: 'Bearing seizure', conditionOnRemoval: 'damaged',
      }),
    });
    expect(tx.sparePartReturn.create).toHaveBeenCalled();
  });

  it('derives serialized return identity from the removed installed spare', async () => {
    tx.installedSparePart.findUnique.mockResolvedValue({
      id: 'installed-1', componentId: 'component-1', inventoryItemId: 'inv-1', partName: 'Bearing 6205',
      serialNumber: 'SN-6205-A', quantity: 1, status: 'removed',
      component: { id: 'component-1', assetId: 'asset-1', asset: { plantId: 'plant-1' } },
      inventoryItem: { id: 'inv-1', name: 'Bearing 6205', itemCode: 'BR-6205', plantId: 'plant-1' },
    });
    tx.sparePartReturn.findUnique.mockResolvedValue(null);
    tx.sparePartReturn.create.mockResolvedValue({ id: 'spr-linked', status: 'pending', installedSparePartId: 'installed-1' });

    await createSparePartReturnWithCustody({
      returnNumber: 'SPR-LINKED', workOrderId: 'wo-2', installedSparePartId: 'installed-1',
      itemName: 'typed text ignored', quantity: 1, plantId: 'plant-1', requestedById: 'tech-1',
      refurbishmentNeeded: true, isConsumed: false,
    });

    expect(tx.sparePartReturn.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        installedSparePartId: 'installed-1', componentId: 'component-1', itemId: 'inv-1',
        itemName: 'Bearing 6205', partSerialNumber: 'SN-6205-A', quantity: 1,
      }),
    }));
    expect(tx.inventoryItem.updateMany).not.toHaveBeenCalled();
  });

  it('moves the linked installed spare to returned_to_store in the same store-return transaction', async () => {
    tx.sparePartReturn.findUnique.mockResolvedValue({
      id: 'spr-linked', returnNumber: 'SPR-LINKED', status: 'refurbished', refurbishmentNeeded: true, returnedToStoreAt: null,
      installedSparePartId: 'installed-1', itemId: 'inv-1', quantity: 1, plantId: 'plant-1',
      workOrder: { woNumber: 'WO-2', plantId: 'plant-1' }, item: { id: 'inv-1', currentStock: 3, plantId: 'plant-1' },
    });
    tx.inventoryItem.findUnique.mockResolvedValue({ id: 'inv-1', currentStock: 3 });
    tx.sparePartReturn.findUniqueOrThrow.mockResolvedValue({ id: 'spr-linked', status: 'returned_to_store' });

    await returnSparePartToStore('spr-linked', 'store-1');

    expect(tx.installedSparePart.updateMany).toHaveBeenCalledWith({
      where: { id: 'installed-1', status: 'removed' }, data: { status: 'returned_to_store' },
    });
    expect(tx.inventoryItem.updateMany).toHaveBeenCalledWith({ where: { id: 'inv-1', currentStock: 3 }, data: { currentStock: 4 } });
  });

  it('consumed spare increments consumedQty without fabricating quantityReturned', async () => {
    const req = material({ consumedQty: 2, quantityReturned: 1, quantityIssued: 10 });
    tx.repairMaterialRequest.findUnique.mockResolvedValue(req);
    tx.sparePartReturn.create.mockResolvedValue({ id: 'spr-1', status: 'disposed' });

    const result = await createSparePartReturnWithCustody({
      returnNumber: 'SPR-1', workOrderId: 'wo-1', materialRequestId: 'mat-1', itemName: 'Bearing', quantity: 2,
      plantId: 'plant-1', requestedById: 'tech-1', refurbishmentNeeded: false, isConsumed: true,
    });

    expect(tx.repairMaterialRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ consumedQty: 4 }),
    }));
    const update = tx.repairMaterialRequest.updateMany.mock.calls[0][0];
    expect(update.data).not.toHaveProperty('quantityReturned');
    expect(result.materialAccounting).toEqual(expect.objectContaining({ quantityReturned: 1 }));
  });

  it('reusable spare return updates custody without adding store inventory', async () => {
    tx.repairMaterialRequest.findUnique.mockResolvedValue(material({ quantityIssued: 5, quantityReturned: 1 }));
    tx.sparePartReturn.create.mockResolvedValue({ id: 'spr-1', status: 'pending' });

    await createSparePartReturnWithCustody({
      returnNumber: 'SPR-1', workOrderId: 'wo-1', materialRequestId: 'mat-1', itemName: 'Bearing', quantity: 2,
      plantId: 'plant-1', requestedById: 'tech-1', refurbishmentNeeded: true, isConsumed: false,
    });

    expect(tx.repairMaterialRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ quantityReturned: 3 }) }));
    expect(tx.inventoryItem.updateMany).not.toHaveBeenCalled();
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });

  it('returns inspected reusable spare directly to store when refurbishment is not needed', async () => {
    tx.sparePartReturn.findUnique.mockResolvedValue({
      id: 'spr-ready', returnNumber: 'SPR-READY', status: 'inspected', refurbishmentNeeded: false, returnedToStoreAt: null,
      itemId: 'inv-1', quantity: 1, plantId: 'plant-1',
      workOrder: { woNumber: 'WO-1', plantId: 'plant-1' }, item: { id: 'inv-1', currentStock: 4, plantId: 'plant-1' },
    });
    tx.inventoryItem.findUnique.mockResolvedValue({ id: 'inv-1', currentStock: 4 });
    tx.sparePartReturn.findUniqueOrThrow.mockResolvedValue({ id: 'spr-ready', status: 'returned_to_store' });

    await returnSparePartToStore('spr-ready', 'store-1');

    expect(tx.sparePartReturn.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'inspected', refurbishmentNeeded: false }),
      data: expect.objectContaining({ status: 'returned_to_store' }),
    }));
    expect(tx.inventoryItem.updateMany).toHaveBeenCalledWith({ where: { id: 'inv-1', currentStock: 4 }, data: { currentStock: 5 } });
    expect(tx.stockMovement.create).toHaveBeenCalledTimes(1);
  });

  it('returns refurbished spare to store exactly once', async () => {
    tx.sparePartReturn.findUnique.mockResolvedValue({
      id: 'spr-1', returnNumber: 'SPR-1', status: 'refurbished', returnedToStoreAt: null, itemId: 'inv-1', quantity: 2,
      workOrder: { woNumber: 'WO-1' }, item: { id: 'inv-1', currentStock: 9 },
    });
    tx.inventoryItem.findUnique.mockResolvedValue({ id: 'inv-1', currentStock: 9 });
    tx.sparePartReturn.findUniqueOrThrow.mockResolvedValue({ id: 'spr-1', status: 'returned_to_store' });

    await returnSparePartToStore('spr-1', 'store-1');
    expect(tx.inventoryItem.updateMany).toHaveBeenCalledWith({ where: { id: 'inv-1', currentStock: 9 }, data: { currentStock: 11 } });
    expect(tx.stockMovement.create).toHaveBeenCalledTimes(1);

    tx.sparePartReturn.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(returnSparePartToStore('spr-1', 'store-1')).rejects.toBeInstanceOf(MaterialCustodyConflictError);
  });
});
