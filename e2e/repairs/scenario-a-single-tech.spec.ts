/**
 * Scenario A — Single Technician Full Lifecycle (UAT-01)
 *
 * Deterministic industrial lifecycle using real seeded inventory/tool records:
 * MR → approval → WO → execution → labor → material/tool custody → measurement
 * → material reconciliation → completion → verification → planner close → reports.
 */
import { test, expect, type BrowserContext } from '@playwright/test';
import { authenticateAs, navigateToWODetail, expectWODetailStatus } from './helpers/auth';
import {
  getToken,
  approveMR,
  convertMR,
  startWO,
  logTime,
  completeWO,
  verifyWO,
  closeWO,
  getWO,
  getMR,
  lookupUserByKey,
  lookupAssetId,
  lookupPlantId,
  lookupToolId,
  expectFailure,
  apiCall,
} from './helpers/api';

const BASE = (process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

test('UAT-01: Scenario A — Single-Tech Full Lifecycle', async ({ browser }) => {
  const context: BrowserContext = await browser.newContext();

  let mrId = '';
  let woId = '';
  let assetId = '';
  let plantId = '';
  let componentId = '';
  let techSingleUserId = '';
  let techAssistantUserId = '';
  let supervisorUserId = '';
  let toolRequestId = '';
  let materialRequestId = '';
  let materialItemId = '';
  let materialUnitCost = 0;
  let realToolId = '';

  try {
    const plannerToken = await getToken('planner');
    techSingleUserId = await lookupUserByKey(plannerToken, 'tech_single');
    techAssistantUserId = await lookupUserByKey(plannerToken, 'tech_assistant');
    supervisorUserId = await lookupUserByKey(plannerToken, 'supervisor');
    assetId = await lookupAssetId(plannerToken, 'UAT-PUMP-001');
    plantId = await lookupPlantId(plannerToken, 'PLANT-A');
    realToolId = await lookupToolId(plannerToken, 'UAT-CAL-VALID');

    const { status: componentLookupStatus, data: componentLookupData } = await apiCall(
      plannerToken,
      'GET',
      `/api/component-registry?assetId=${encodeURIComponent(assetId)}&search=${encodeURIComponent('UAT-PUMP-BRG-DE')}`,
    );
    expect(componentLookupStatus).toBe(200);
    expect(componentLookupData.success).toBe(true);
    const pumpComponent = (componentLookupData.data as Array<any>).find(
      (component) => component.componentCode === 'UAT-PUMP-BRG-DE',
    );
    expect(pumpComponent).toBeTruthy();
    componentId = pumpComponent.id;

    // Maintenance technicians must not gain the full Inventory workspace merely
    // because they need to select a material for a repair.
    const techLookupToken = await getToken('tech_single');
    const blockedInventory = await apiCall(
      techLookupToken,
      'GET',
      `/api/inventory?search=${encodeURIComponent('UAT-BRG-6205')}&plantId=${plantId}`,
    );
    expect(blockedInventory.status).toBe(403);

    const { status: lookupStatus, data: lookupData } = await apiCall(
      techLookupToken,
      'GET',
      `/api/inventory?mode=lookup&search=${encodeURIComponent('UAT-BRG-6205')}&plantId=${plantId}`,
    );
    expect(lookupStatus).toBe(200);
    const lookupMaterial = (lookupData.data as Array<any>).find((item) => item.itemCode === 'UAT-BRG-6205');
    expect(lookupMaterial).toBeTruthy();
    expect(lookupMaterial.unitCost).toBeUndefined();
    materialItemId = lookupMaterial.id;

    // Store custody roles retain the authoritative inventory workspace/cost view.
    const storeLookupToken = await getToken('storekeeper');
    const { status: inventoryStatus, data: inventoryData } = await apiCall(
      storeLookupToken,
      'GET',
      `/api/inventory?search=${encodeURIComponent('UAT-BRG-6205')}&plantId=${plantId}`,
    );
    expect(inventoryStatus).toBe(200);
    const material = (inventoryData.data as Array<any>).find((item) => item.itemCode === 'UAT-BRG-6205');
    expect(material).toBeTruthy();
    materialUnitCost = Number(material.unitCost);
    expect(materialUnitCost).toBe(120);

    await test.step('A1: Requester creates Maintenance Request', async () => {
      const token = await getToken('requester');
      const { status, data } = await apiCall(token, 'POST', '/api/maintenance-requests', {
        title: 'UAT-SingleTech-Pump-Vibration',
        description: 'Abnormal vibration at 3000 RPM on centrifugal pump. Needs bearing inspection.',
        assetId,
        priority: 'high',
        plantId,
        supervisorId: supervisorUserId,
      });
      expect(status).toBe(201);
      expect(data.success).toBe(true);
      const mr = data.data;
      mrId = mr.id;
      expect(mrId).toBeTruthy();
      expect(mr.requestNumber).toMatch(/^MR-\d{6}-\d{4}$/);
      expect(mr.supervisorId).toBe(supervisorUserId);
      expect((await getMR(token, mrId)).status).toBe('pending');
    });

    await test.step('A2: Supervisor approves Maintenance Request', async () => {
      const token = await getToken('supervisor');
      const result = await approveMR(token, mrId);
      expect(result.status).toBe('approved');
      expect((await getMR(token, mrId)).status).toBe('approved');
    });

    await test.step('A3: Planner converts MR to WO, assigns technician, and links component', async () => {
      const token = await getToken('planner');
      const wo = await convertMR(token, mrId, {
        assignedTo: techSingleUserId,
        assignedSupervisorId: supervisorUserId,
        tradeActivity: 'mechanical',
        workOrderType: 'corrective',
        priority: 'high',
      });
      woId = wo.id;
      expect(woId).toBeTruthy();
      expect(wo.woNumber).toMatch(/^WO-\d{6}-\d{4}$/);
      const fetched = await getWO(token, woId);
      expect(fetched.status).toBe('assigned');
      expect(fetched.assignedTo).toBe(techSingleUserId);
      expect((await getMR(token, mrId)).status).toBe('converted');

      const { status: componentLinkStatus, data: componentLinkData } = await apiCall(
        token,
        'PUT',
        `/api/work-orders/${woId}/components`,
        { componentIds: [componentId] },
      );
      expect(componentLinkStatus).toBe(200);
      expect(componentLinkData.success).toBe(true);
      expect(componentLinkData.data).toHaveLength(1);
      expect(componentLinkData.data[0].componentRegistryId).toBe(componentId);
      expect(componentLinkData.data[0].componentRegistry?.componentCode).toBe('UAT-PUMP-BRG-DE');
    });

    await test.step('A4: Technician starts work', async () => {
      const token = await getToken('tech_single');
      await startWO(token, woId);
      const fetched = await getWO(token, woId);
      expect(fetched.status).toBe('in_progress');
      expect(fetched.actualStart).toBeTruthy();

      await authenticateAs(context, 'tech_single');
      const page = await context.newPage();
      await navigateToWODetail(page, woId);
      await expectWODetailStatus(page, 'in_progress');
      await page.close();
    });

    await test.step('A5: Technician stops live timer then records 2.5 manual labor hours', async () => {
      const token = await getToken('tech_single');
      const { status: stopStatus, data: stopData } = await apiCall(
        token,
        'POST',
        `/api/work-orders/${woId}/time-logs/stop`,
        {},
      );
      expect(stopStatus).toBe(200);
      expect(stopData.success).toBe(true);
      expect(stopData.data.closedTimers).toBeGreaterThanOrEqual(1);

      const timeLog = await logTime(token, woId, {
        action: 'start',
        manualHours: 2.5,
        notes: 'Disassembled pump casing and replaced bearing',
      });
      expect(timeLog.id).toBeTruthy();
      expect((await getWO(token, woId)).actualHours).toBeGreaterThanOrEqual(2.5);
    });

    await test.step('A6: Real inventory bearing is requested, approved and issued', async () => {
      const techToken = await getToken('tech_single');
      const supToken = await getToken('supervisor');
      const storeToken = await getToken('storekeeper');

      const { status: createStatus, data: createData } = await apiCall(
        techToken,
        'POST',
        '/api/repairs/material-requests',
        {
          workOrderId: woId,
          itemId: materialItemId,
          itemName: 'UAT Bearing 6205',
          quantityRequested: 2,
          unit: 'each',
          urgency: 'normal',
          reason: 'Replacement bearings for pump overhaul',
        },
      );
      expect(createStatus).toBe(201);
      materialRequestId = createData.data.id;
      expect(createData.data.itemId).toBe(materialItemId);
      expect(Number(createData.data.unitCost)).toBe(materialUnitCost);

      const { status: supervisorStatus, data: supervisorData } = await apiCall(
        supToken,
        'POST',
        `/api/repairs/material-requests/${materialRequestId}`,
        { action: 'supervisor_approve' },
      );
      expect(supervisorStatus).toBe(200);
      expect(supervisorData.data.status).toBe('supervisor_approved');

      const { status: storeStatus, data: storeData } = await apiCall(
        storeToken,
        'POST',
        `/api/repairs/material-requests/${materialRequestId}`,
        { action: 'storekeeper_approve' },
      );
      expect(storeStatus).toBe(200);
      expect(storeData.data.status).toBe('storekeeper_approved');

      const { status: issueStatus, data: issueData } = await apiCall(
        storeToken,
        'POST',
        `/api/repairs/material-requests/${materialRequestId}`,
        { action: 'issue' },
      );
      expect(issueStatus).toBe(200);
      expect(issueData.data.status).toBe('issued');
      expect(Number(issueData.data.quantityIssued)).toBe(2);
    });

    await test.step('A7: Real calibrated tool is requested, approved and issued', async () => {
      const techToken = await getToken('tech_single');
      const supToken = await getToken('supervisor');
      const storeToken = await getToken('storekeeper');

      const { status: createStatus, data: createData } = await apiCall(
        techToken,
        'POST',
        '/api/repairs/tool-requests',
        {
          workOrderId: woId,
          reason: 'Need calibrated tool for bearing installation',
          urgency: 'normal',
          items: [{ toolId: realToolId, toolName: 'UAT-CAL-VALID', quantityRequested: 1 }],
        },
      );
      expect(createStatus).toBe(201);
      toolRequestId = createData.data.id;
      const toolLineId = createData.data.items[0].id;

      expect((await apiCall(supToken, 'POST', `/api/repairs/tool-requests/${toolRequestId}`, { action: 'supervisor_approve' })).status).toBe(200);
      expect((await apiCall(storeToken, 'POST', `/api/repairs/tool-requests/${toolRequestId}`, { action: 'storekeeper_approve' })).status).toBe(200);

      const { status: issueStatus, data: issueData } = await apiCall(
        storeToken,
        'POST',
        `/api/repairs/tool-requests/${toolRequestId}`,
        { action: 'issue', issuedItems: [{ itemId: toolLineId, quantityIssued: 1 }] },
      );
      expect(issueStatus).toBe(200);
      expect(issueData.data.status).toBe('issued');
    });

    await test.step('A8: Technician records configured component condition measurement', async () => {
      const token = await getToken('tech_single');
      const { status: optionsStatus, data: optionsData } = await apiCall(
        token,
        'GET',
        `/api/work-orders/${woId}/measurements?componentId=${encodeURIComponent(componentId)}`,
      );
      expect(optionsStatus).toBe(200);
      expect(optionsData.success).toBe(true);
      const configuredPoint = (optionsData.options as Array<any>).find(
        (option) => option.componentId === componentId && option.parameterKey === 'vibration',
      );
      expect(configuredPoint).toBeTruthy();
      expect(configuredPoint.selectable).toBe(true);
      expect(configuredPoint.unit).toBe('mm/s');
      expect(Number(configuredPoint.acceptableMax)).toBe(4.5);

      const { status, data } = await apiCall(
        token,
        'POST',
        `/api/work-orders/${woId}/measurements`,
        {
          componentId: configuredPoint.componentId,
          parameterKey: configuredPoint.parameterKey,
          value: 0.45,
        },
      );
      expect(status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data.componentId).toBe(componentId);
      expect(data.data.parameterKey).toBe('vibration');
      expect(data.data.unit).toBe('mm/s');
      expect(Number(data.data.maxThreshold)).toBe(4.5);
      expect(Number(data.data.value)).toBe(0.45);
      expect(data.data.isAlarm).toBe(false);

      const { status: readStatus, data: measData } = await apiCall(
        token,
        'GET',
        `/api/work-orders/${woId}/measurements?componentId=${encodeURIComponent(componentId)}`,
      );
      expect(readStatus).toBe(200);
      expect(measData.success).toBe(true);
      const reading = (measData.data as Array<any>).find((entry) => entry.id === data.data.id);
      expect(reading).toBeTruthy();
      expect(reading.componentId).toBe(componentId);
      expect(reading.parameterKey).toBe('vibration');
    });

    await test.step('A9: Tool returned and material usage reconciled 2 = 1 consumed + 1 returned', async () => {
      const techToken = await getToken('tech_single');
      const storeToken = await getToken('storekeeper');

      const { data: toolReq } = await apiCall(techToken, 'GET', `/api/repairs/tool-requests/${toolRequestId}`);
      const toolLineId = toolReq.data.items[0].id;
      const otherTechToken = await getToken('tech_assistant');

      const blockedReturn = await expectFailure(
        otherTechToken,
        'POST',
        `/api/repairs/tool-requests/${toolRequestId}`,
        {
          action: 'return',
          returnedItems: [{ itemId: toolLineId, quantityReturned: 1, conditionAtReturn: 'good' }],
        },
      );
      expect(blockedReturn.status).toBe(403);
      expect(String(blockedReturn.data.error)).toContain('technician/custodian');

      const blockedTransfer = await expectFailure(
        otherTechToken,
        'POST',
        '/api/repairs/tool-transfers',
        {
          toolId: realToolId,
          fromUserId: techSingleUserId,
          toUserId: techAssistantUserId,
          reason: 'Custody validation test',
        },
      );
      expect(blockedTransfer.status).toBe(403);
      expect(String(blockedTransfer.data.error)).toContain('current tool custodian');

      expect((await apiCall(techToken, 'POST', `/api/repairs/tool-requests/${toolRequestId}`, {
        action: 'return',
        returnedItems: [{ itemId: toolLineId, quantityReturned: 1, conditionAtReturn: 'good' }],
      })).status).toBe(200);

      const { status: confirmStatus, data: confirmData } = await apiCall(
        storeToken,
        'POST',
        `/api/repairs/tool-requests/${toolRequestId}`,
        { action: 'storekeeper_confirm_return' },
      );
      expect(confirmStatus).toBe(200);
      expect(confirmData.data.status).toBe('returned');

      const { status: consumeStatus } = await apiCall(
        techToken,
        'POST',
        `/api/repairs/material-requests/${materialRequestId}`,
        { action: 'consume_material', approvedQuantity: 1 },
      );
      expect(consumeStatus).toBe(200);

      const { status: returnStatus } = await apiCall(
        storeToken,
        'POST',
        `/api/repairs/material-requests/${materialRequestId}`,
        { action: 'record_return', quantityReturned: 1, returnCondition: 'serviceable' },
      );
      expect(returnStatus).toBe(200);

      const { status: reconcileStatus, data: reconcileData } = await apiCall(
        storeToken,
        'POST',
        `/api/repairs/material-requests/${materialRequestId}`,
        { action: 'reconcile' },
      );
      expect(reconcileStatus).toBe(200);
      expect(reconcileData.data.status).toBe('closed');

      const { data: materialReq } = await apiCall(
        techToken,
        'GET',
        `/api/repairs/material-requests/${materialRequestId}`,
      );
      expect(Number(materialReq.data.quantityIssued)).toBe(2);
      expect(Number(materialReq.data.consumedQty)).toBe(1);
      expect(Number(materialReq.data.wastedQty ?? 0)).toBe(0);
      expect(Number(materialReq.data.quantityReturned)).toBe(1);
    });

    await test.step('A10: Technician completes WO with authoritative cost snapshot', async () => {
      const token = await getToken('tech_single');
      await completeWO(token, woId, 'Bearing replaced. Vibration normalized. All resources reconciled.');

      const fetched = await getWO(token, woId);
      expect(fetched.status).toBe('completed');
      expect(fetched.actualHours).toBeGreaterThanOrEqual(2.5);
      expect(Number(fetched.partsCost)).toBe(materialUnitCost);
      expect(fetched.laborCurrency).toBe('GHS');

      await authenticateAs(context, 'tech_single');
      const page = await context.newPage();
      await navigateToWODetail(page, woId);
      await expectWODetailStatus(page, 'completed');
      await page.close();
    });

    await test.step('A11: Supervisor verifies WO', async () => {
      const token = await getToken('supervisor');
      await verifyWO(token, woId, 4);
      expect((await getWO(token, woId)).status).toBe('verified');
    });

    await test.step('A12: Planner closes and locks WO', async () => {
      const token = await getToken('planner');
      await closeWO(token, woId);
      const fetched = await getWO(token, woId);
      expect(fetched.status).toBe('closed');
      expect(fetched.isLocked).toBe(true);
      expect(Number(fetched.partsCost)).toBe(materialUnitCost);
      expect(fetched.laborCurrency).toBe('GHS');

      await authenticateAs(context, 'planner');
      const page = await context.newPage();
      await navigateToWODetail(page, woId);
      await expectWODetailStatus(page, 'closed');
      await page.close();
    });

    await test.step('A13: Closed WO cannot be restarted or modified', async () => {
      const techToken = await getToken('tech_single');
      const { status: startStatus } = await expectFailure(techToken, 'POST', `/api/work-orders/${woId}/start`);
      expect(startStatus).toBeGreaterThanOrEqual(400);
      const { status: measStatus } = await expectFailure(
        techToken,
        'POST',
        `/api/work-orders/${woId}/measurements`,
        { componentId, parameterKey: 'vibration', value: 99, unit: 'mm/s' },
      );
      expect(measStatus).toBeGreaterThanOrEqual(400);
    });

    await test.step('A14: Closed WO PDF pack is a real PDF', async () => {
      const token = await getToken('planner');
      const res = await fetch(`${BASE}/api/work-orders/${woId}/closed-pack`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type') || '').toContain('application/pdf');
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(bytes.length).toBeGreaterThan(100);
      expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('%PDF');
    });

    await test.step('A15: Closed WO XLSX export responds successfully', async () => {
      const token = await getToken('planner');
      const res = await fetch(`${BASE}/api/repairs/reports/xlsx`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportType: 'work-order', format: 'xlsx', filters: { status: 'closed', plantId } }),
      });
      expect(res.status).toBe(200);
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(bytes.length).toBeGreaterThan(100);
      expect(String.fromCharCode(...bytes.slice(0, 2))).toBe('PK');
    });
  } finally {
    await context.close();
  }
});
