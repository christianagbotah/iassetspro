/**
 * Scenario AA — Damaged material return custody (UAT-26)
 *
 * Proves that an issued work-order material returned as damaged is not restored
 * to usable inventory. The physical quantity enters the existing spare-part
 * inspection/refurbishment custody ledger and is credited back to stock only
 * after refurbishment is completed and store custody accepts it.
 */
import { test, expect, type Page } from '@playwright/test';
import { authenticateAs } from './helpers/auth';
import {
  apiCall,
  approveMR,
  convertMR,
  createMR,
  getToken,
  lookupAssetId,
  lookupPlantId,
  lookupUserByKey,
  startWO,
} from './helpers/api';

function waitForMaterialAction(page: Page, materialRequestId: string, action: string) {
  return page.waitForResponse((response) => {
    if (response.request().method() !== 'POST' || !response.url().endsWith(`/api/repairs/material-requests/${materialRequestId}`)) return false;
    try {
      const body = response.request().postDataJSON() as { action?: string } | null;
      return body?.action === action;
    } catch {
      return false;
    }
  });
}

async function inventoryStock(token: string, plantId: string, itemCode: string, itemId: string) {
  const response = await apiCall(
    token,
    'GET',
    `/api/inventory?search=${encodeURIComponent(itemCode)}&plantId=${encodeURIComponent(plantId)}`,
  );
  expect(response.status).toBe(200);
  const item = (response.data.data as Array<any>).find((row: any) => row.id === itemId);
  expect(item, `Inventory item ${itemCode} should remain queryable`).toBeTruthy();
  return Number(item.currentStock);
}

test('UAT-26: damaged material return stays out of usable stock until refurbishment release', async ({ browser }) => {
  test.setTimeout(180_000);

  const inventoryToken = await getToken('inventory_manager');
  const requesterToken = await getToken('requester');
  const supervisorToken = await getToken('supervisor');
  const plannerToken = await getToken('planner');
  const technicianToken = await getToken('tech_single');
  const storeToken = await getToken('storekeeper');

  const plantId = await lookupPlantId(inventoryToken, 'PLANT-A');
  const assetId = await lookupAssetId(plannerToken, 'UAT-PUMP-001');
  const supervisorId = await lookupUserByKey(plannerToken, 'supervisor');
  const technicianId = await lookupUserByKey(plannerToken, 'tech_single');
  const suffix = `${Date.now()}`.slice(-8);
  const itemCode = `UAT-DMR-${suffix}`;
  const itemName = `UAT Damaged Return Bearing ${suffix}`;

  const itemResponse = await apiCall(inventoryToken, 'POST', '/api/inventory', {
    itemCode,
    name: itemName,
    category: 'spare_part',
    unitOfMeasure: 'each',
    currentStock: 3,
    minStockLevel: 0,
    unitCost: 120,
    plantId,
  });
  expect(itemResponse.status).toBe(201);
  expect(itemResponse.data.success).toBe(true);
  const item = itemResponse.data.data;
  expect(await inventoryStock(inventoryToken, plantId, itemCode, item.id)).toBe(3);

  const mr = await createMR(requesterToken, {
    title: `UAT damaged material return ${suffix}`,
    description: 'Issue a spare to a repair, return it damaged, refurbish it, and release it back to store.',
    assetId,
    priority: 'high',
    plantId,
    supervisorId,
  });
  await approveMR(supervisorToken, mr.id);
  const wo = await convertMR(plannerToken, mr.id, {
    assignedTo: technicianId,
    assignedSupervisorId: supervisorId,
    assignmentType: 'direct',
    tradeActivity: 'mechanical',
    workOrderType: 'corrective',
    priority: 'high',
  });
  await startWO(technicianToken, wo.id);
  const timerStop = await apiCall(technicianToken, 'POST', `/api/work-orders/${wo.id}/time-logs/stop`, {});
  expect(timerStop.status).toBe(200);

  const materialCreate = await apiCall(technicianToken, 'POST', `/api/work-orders/${wo.id}/materials`, {
    itemId: item.id,
    quantity: 2,
    urgency: 'high',
    reason: 'UAT-26 damaged-return custody proof',
  });
  expect(materialCreate.status).toBe(201);
  const materialRequestId = materialCreate.data.data.repairMaterialRequest.id as string;
  expect(materialRequestId).toBeTruthy();

  const supervisorApproval = await apiCall(supervisorToken, 'POST', `/api/repairs/material-requests/${materialRequestId}`, {
    action: 'supervisor_approve',
    approvedQuantity: 2,
  });
  expect(supervisorApproval.status).toBe(200);

  const storeApproval = await apiCall(storeToken, 'POST', `/api/repairs/material-requests/${materialRequestId}`, {
    action: 'storekeeper_approve',
    approvedQuantity: 2,
  });
  expect(storeApproval.status).toBe(200);
  expect(await inventoryStock(inventoryToken, plantId, itemCode, item.id)).toBe(1);

  const pick = await apiCall(storeToken, 'POST', '/api/repairs/material-requests/pick', { id: materialRequestId });
  expect(pick.status).toBe(200);
  const issue = await apiCall(storeToken, 'POST', `/api/repairs/material-requests/${materialRequestId}`, {
    action: 'issue',
    approvedQuantity: 2,
  });
  expect(issue.status).toBe(200);
  expect(await inventoryStock(inventoryToken, plantId, itemCode, item.id)).toBe(1);

  const storeContext = await browser.newContext();
  await authenticateAs(storeContext, 'storekeeper');
  const storePage = await storeContext.newPage();

  await test.step('Store classifies the physical return as damaged in the actual Repairs UI', async () => {
    await storePage.goto('/#/repairs-material-requests');
    await expect(storePage.getByRole('heading', { name: 'Material Requests' })).toBeVisible();
    await storePage.getByPlaceholder('Search items or WO#...').fill(itemName);
    const row = storePage.locator('tbody tr').filter({ hasText: itemName }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText('Issued');

    await row.getByRole('button', { name: 'Record Return', exact: true }).click();
    const dialog = storePage.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Return Quantity' })).toBeVisible();
    await dialog.locator('input[type="number"]').fill('2');
    await dialog.getByRole('combobox').click();
    await storePage.getByRole('option', { name: /Damaged — quarantine for inspection \/ repair/i }).click();

    const responsePromise = waitForMaterialAction(storePage, materialRequestId, 'record_return');
    await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
    const response = await responsePromise;
    const requestBody = response.request().postDataJSON() as { returnCondition?: string; quantityReturned?: number };
    expect(response.status()).toBe(200);
    expect(requestBody.returnCondition).toBe('damaged');
    expect(Number(requestBody.quantityReturned)).toBe(2);
  });

  await test.step('Damaged quantity enters inspection custody without usable-stock credit', async () => {
    expect(await inventoryStock(inventoryToken, plantId, itemCode, item.id)).toBe(1);

    const materialState = await apiCall(storeToken, 'GET', `/api/repairs/material-requests/${materialRequestId}`);
    expect(materialState.status).toBe(200);
    expect(materialState.data.data.status).toBe('fully_returned');
    expect(Number(materialState.data.data.quantityReturned)).toBe(2);

    const returns = await apiCall(
      storeToken,
      'GET',
      `/api/repairs/spare-part-returns?workOrderId=${encodeURIComponent(wo.id)}&itemId=${encodeURIComponent(item.id)}&limit=20`,
    );
    expect(returns.status).toBe(200);
    const hold = (returns.data.data as Array<any>).find((record: any) => record.materialRequestId === materialRequestId);
    expect(hold).toBeTruthy();
    expect(hold.status).toBe('pending');
    expect(hold.conditionOnReturn).toBe('damaged');
    expect(hold.refurbishmentNeeded).toBe(true);
    expect(Number(hold.quantity)).toBe(2);

    const inspect = await apiCall(supervisorToken, 'POST', `/api/repairs/spare-part-returns/${hold.id}`, {
      action: 'inspect',
      refurbishmentNeeded: true,
      inspectionNotes: 'UAT-26 inspection confirms repairable damage.',
      refurbishmentNotes: 'Replace damaged race and verify clearances.',
    });
    expect(inspect.status).toBe(200);
    expect(inspect.data.data.status).toBe('inspected');

    const startRefurbishment = await apiCall(supervisorToken, 'POST', `/api/repairs/spare-part-returns/${hold.id}`, {
      action: 'start_refurbishment',
    });
    expect(startRefurbishment.status).toBe(200);
    expect(startRefurbishment.data.data.status).toBe('refurbishing');

    const completeRefurbishment = await apiCall(supervisorToken, 'POST', `/api/repairs/spare-part-returns/${hold.id}`, {
      action: 'complete_refurbishment',
      actualRefurbCost: 35,
    });
    expect(completeRefurbishment.status).toBe(200);
    expect(completeRefurbishment.data.data.status).toBe('refurbished');
    expect(await inventoryStock(inventoryToken, plantId, itemCode, item.id)).toBe(1);

    const release = await apiCall(storeToken, 'POST', `/api/repairs/spare-part-returns/${hold.id}`, {
      action: 'return_to_store',
    });
    expect(release.status).toBe(200);
    expect(release.data.data.status).toBe('returned_to_store');
    expect(await inventoryStock(inventoryToken, plantId, itemCode, item.id)).toBe(3);

    const finalHold = await apiCall(storeToken, 'GET', `/api/repairs/spare-part-returns/${hold.id}`);
    expect(finalHold.status).toBe(200);
    expect(finalHold.data.data.status).toBe('returned_to_store');
    expect(finalHold.data.data.returnedToStoreAt).toBeTruthy();
  });

  await storeContext.close();
});
