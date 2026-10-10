/**
 * Scenario AB — Damaged Tool Quantity Repair Custody (UAT-27)
 *
 * Proves aggregate tool stock remains quantity-safe across issue, damaged
 * return, repair completion, and store/QC acceptance. Setup uses the real API;
 * final QC release is exercised through the operator UI.
 */
import { test, expect, type BrowserContext } from '@playwright/test';
import {
  getToken,
  createMR,
  approveMR,
  convertMR,
  startWO,
  lookupUserByKey,
  lookupAssetId,
  lookupPlantId,
  apiCall,
} from './helpers/api';
import { authenticateAs } from './helpers/auth';

test('UAT-27: damaged tool quantity stays quarantined until store/QC acceptance', async ({ browser }) => {
  const context: BrowserContext = await browser.newContext();
  let toolId = '';
  let toolRequestId = '';
  let toolRequestItemId = '';
  let damageReportId = '';
  let damageReportNumber = '';

  try {
    const plannerToken = await getToken('planner');
    const requesterToken = await getToken('requester');
    const supervisorToken = await getToken('supervisor');
    const techToken = await getToken('tech_single');
    const storeToken = await getToken('storekeeper');
    const inventoryToken = await getToken('inventory_manager');
    const techUserId = await lookupUserByKey(plannerToken, 'tech_single');
    const supervisorUserId = await lookupUserByKey(plannerToken, 'supervisor');
    const assetId = await lookupAssetId(plannerToken, 'UAT-PUMP-001');
    const plantId = await lookupPlantId(plannerToken, 'PLANT-A');

    let woId = '';

    await test.step('AB1: create 3-unit tool stock and issue 2 units to a work order', async () => {
      const toolCreate = await apiCall(inventoryToken, 'POST', '/api/tools', {
        name: 'UAT Repair Custody Torque Wrench',
        description: 'UAT-27 aggregate quantity custody tool',
        category: 'hand_tools',
        condition: 'good',
        status: 'available',
        quantity: 3,
        plantId,
      });
      expect(toolCreate.status).toBe(201);
      expect(toolCreate.data.success).toBe(true);
      toolId = toolCreate.data.data.id;
      expect(toolId).toBeTruthy();

      const mr = await createMR(requesterToken, {
        title: 'UAT-27 damaged tool repair custody',
        description: 'Quantity-level damaged tool return and QC release proof.',
        assetId,
        priority: 'high',
        plantId,
      });
      await approveMR(supervisorToken, mr.id);
      const wo = await convertMR(plannerToken, mr.id, {
        assignedTo: techUserId,
        assignedSupervisorId: supervisorUserId,
        tradeActivity: 'mechanical',
        workOrderType: 'corrective',
        priority: 'high',
      });
      woId = wo.id;
      await startWO(techToken, woId);

      const createdRequest = await apiCall(techToken, 'POST', '/api/repairs/tool-requests', {
        workOrderId: woId,
        reason: 'UAT-27 quantity custody proof',
        urgency: 'normal',
        items: [{ toolId, toolName: 'UAT Repair Custody Torque Wrench', quantityRequested: 2 }],
      });
      expect(createdRequest.status).toBe(201);
      toolRequestId = createdRequest.data.data.id;
      toolRequestItemId = createdRequest.data.data.items[0].id;

      expect((await apiCall(supervisorToken, 'POST', `/api/repairs/tool-requests/${toolRequestId}`, {
        action: 'supervisor_approve',
      })).status).toBe(200);
      expect((await apiCall(storeToken, 'POST', `/api/repairs/tool-requests/${toolRequestId}`, {
        action: 'storekeeper_approve',
      })).status).toBe(200);
      const issued = await apiCall(storeToken, 'POST', `/api/repairs/tool-requests/${toolRequestId}`, {
        action: 'issue',
        issuedItems: [{ itemId: toolRequestItemId, quantityIssued: 2 }],
      });
      expect(issued.status).toBe(200);

      const toolAfterIssue = await apiCall(inventoryToken, 'GET', `/api/tools/${toolId}`);
      expect(toolAfterIssue.status).toBe(200);
      expect(toolAfterIssue.data.data.quantity).toBe(1);
      expect(toolAfterIssue.data.data.repairQuantity).toBe(0);
      expect(toolAfterIssue.data.data.status).toBe('available');
    });

    await test.step('AB2: damaged return moves only one unit into repair custody', async () => {
      const submitted = await apiCall(techToken, 'POST', `/api/repairs/tool-requests/${toolRequestId}`, {
        action: 'return',
        returnedItems: [{
          itemId: toolRequestItemId,
          quantityReturned: 1,
          conditionAtReturn: 'damaged',
          notes: 'UAT-27 ratchet head cracked under load',
        }],
      });
      expect(submitted.status).toBe(200);
      expect(submitted.data.data.status).toBe('pending_return');

      const confirmed = await apiCall(storeToken, 'POST', `/api/repairs/tool-requests/${toolRequestId}`, {
        action: 'storekeeper_confirm_return',
      });
      expect(confirmed.status).toBe(200);

      const toolAfterReturn = await apiCall(inventoryToken, 'GET', `/api/tools/${toolId}`);
      expect(toolAfterReturn.status).toBe(200);
      expect(toolAfterReturn.data.data.quantity).toBe(1);
      expect(toolAfterReturn.data.data.repairQuantity).toBe(1);
      expect(toolAfterReturn.data.data.status).toBe('available');

      const reports = await apiCall(storeToken, 'GET', `/api/repairs/damaged-tools?toolId=${encodeURIComponent(toolId)}&limit=100`);
      expect(reports.status).toBe(200);
      const report = (reports.data.data as Array<any>).find((item) => item.toolId === toolId && item.toolRequestId === toolRequestId);
      expect(report).toBeTruthy();
      damageReportId = report.id;
      damageReportNumber = report.reportNumber;
      expect(report.quantity).toBe(1);
      expect(report.repairHeldQuantity).toBe(1);
      expect(report.status).toBe('reported');
    });

    await test.step('AB3: repair completion remains quarantined while awaiting QC', async () => {
      expect((await apiCall(storeToken, 'POST', `/api/repairs/damaged-tools/${damageReportId}`, {
        action: 'assess', assessmentNotes: 'Repairable ratchet assembly', estimatedRepairCost: 35,
      })).status).toBe(200);
      expect((await apiCall(storeToken, 'POST', `/api/repairs/damaged-tools/${damageReportId}`, {
        action: 'quote_repair', repairVendorName: 'UAT In-House Workshop', estimatedRepairCost: 35,
      })).status).toBe(200);
      expect((await apiCall(storeToken, 'POST', `/api/repairs/damaged-tools/${damageReportId}`, {
        action: 'start_repair',
      })).status).toBe(200);
      const completed = await apiCall(storeToken, 'POST', `/api/repairs/damaged-tools/${damageReportId}`, {
        action: 'complete_repair', actualRepairCost: 30,
      });
      expect(completed.status).toBe(200);
      expect(completed.data.data.status).toBe('awaiting_qc');

      const toolAwaitingQc = await apiCall(inventoryToken, 'GET', `/api/tools/${toolId}`);
      expect(toolAwaitingQc.data.data.quantity).toBe(1);
      expect(toolAwaitingQc.data.data.repairQuantity).toBe(1);
    });

    await test.step('AB4: store accepts QC in the real UI and only then usable stock is restored', async () => {
      await authenticateAs(context, 'storekeeper');
      const page = await context.newPage();
      await page.goto('/#/repairs-damaged-tools');
      await expect(page.getByRole('heading', { name: 'Damaged Tool Reports' })).toBeVisible({ timeout: 20_000 });

      const row = page.locator('tr').filter({ hasText: damageReportNumber });
      await expect(row).toBeVisible({ timeout: 20_000 });
      await expect(row.getByText('Awaiting Qc', { exact: true })).toBeVisible();
      await row.getByRole('button', { name: 'Accept QC' }).click();
      await expect(page.getByText('Accept Repaired Tool', { exact: true })).toBeVisible();
      await page.getByLabel('QC Notes').fill('UAT-27 functional ratchet test passed');
      await page.getByRole('button', { name: 'Accept QC' }).last().click();
      await expect(page.getByText('Action completed', { exact: true })).toBeVisible({ timeout: 15_000 });
      await page.close();

      const toolAfterQc = await apiCall(inventoryToken, 'GET', `/api/tools/${toolId}`);
      expect(toolAfterQc.data.data.quantity).toBe(2);
      expect(toolAfterQc.data.data.repairQuantity).toBe(0);
      expect(toolAfterQc.data.data.status).toBe('available');

      const reportAfterQc = await apiCall(storeToken, 'GET', `/api/repairs/damaged-tools/${damageReportId}`);
      expect(reportAfterQc.status).toBe(200);
      expect(reportAfterQc.data.data.status).toBe('repaired');
      expect(reportAfterQc.data.data.repairHeldQuantity).toBe(0);
      expect(reportAfterQc.data.data.qcNotes).toContain('functional ratchet test passed');
    });
  } finally {
    await context.close();
  }
});
