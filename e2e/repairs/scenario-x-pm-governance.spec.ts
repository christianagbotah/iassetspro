import { test, expect } from '@playwright/test';
import { authenticateAs } from './helpers/auth';
import { apiCall, apiCallWithPlant, getToken, lookupAssetId, lookupPlantId } from './helpers/api';

test('UAT-23: PM plan governance preserves lifecycle locks and editable template metadata', async ({ page, context }) => {
  const suffix = Date.now().toString().slice(-7);
  const templateTitle = `UAT PM Governance Template ${suffix}`;
  const scheduleTitle = `UAT PM Governance Schedule ${suffix}`;
  const firstTask = `Inspect governance bearing ${suffix}`;
  const lastTask = `Verify governance lubrication ${suffix}`;
  const plannerToken = await getToken('planner');
  const assetId = await lookupAssetId(plannerToken, 'UAT-PUMP-001');
  const plantId = await lookupPlantId(plannerToken, 'PLANT-A');

  let templateId = '';
  let scheduleId = '';

  try {
    const templateCreate = await apiCallWithPlant(plannerToken, 'POST', '/api/pm-templates', plantId, {
      title: templateTitle,
      description: 'UAT PM governance lifecycle template.',
      type: 'preventive',
      category: 'Mechanical',
      estimatedDuration: 1,
      priority: 'medium',
      requiredSkills: ['Mechanical'],
      requiredTools: ['Torque Wrench'],
    });
    expect(templateCreate.status).toBe(201);
    templateId = String(templateCreate.data.data?.id || '');
    expect(templateId).toBeTruthy();

    const createdTasks = await apiCallWithPlant(
      plannerToken,
      'POST',
      `/api/pm-templates/${templateId}/tasks`,
      plantId,
      {
        newTasks: [
          { description: firstTask, taskType: 'mechanical' },
          { description: lastTask, taskType: 'lubrication' },
        ],
      },
    );
    expect(createdTasks.status).toBe(201);

    const scheduleCreate = await apiCallWithPlant(plannerToken, 'POST', '/api/pm-schedules', plantId, {
      title: scheduleTitle,
      description: 'UAT linked active schedule for governance locks.',
      assetId,
      templateId,
      frequencyType: 'time_day',
      frequencyValue: 1,
      frequencyUnit: 'months',
      nextDueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      estimatedDuration: 1,
      priority: 'medium',
      autoGenerateWO: true,
      leadDays: 0,
    });
    expect(scheduleCreate.status).toBe(201);
    scheduleId = String(scheduleCreate.data.data?.id || '');
    expect(scheduleId).toBeTruthy();

    await authenticateAs(context, 'planner');
    await page.goto('/');
    await page.evaluate((selectedPlantId) => localStorage.setItem('user_plant_id', selectedPlantId), plantId);
    await page.goto('/#/pm-templates');
    await expect(page.getByRole('heading', { name: 'PM Templates', exact: true })).toBeVisible({ timeout: 20_000 });
    await page.getByPlaceholder('Search templates...').fill(templateTitle);
    const templateRow = page.getByRole('row').filter({ hasText: templateTitle });
    await expect(templateRow).toBeVisible({ timeout: 15_000 });

    // Metadata edits must persist through the real template UI.
    await templateRow.hover();
    await templateRow.getByRole('button').last().click();
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
    await expect(page.getByText('Edit PM Template', { exact: true })).toBeVisible();
    await page.getByPlaceholder('1.5').fill('1.75');
    await page.getByPlaceholder('Welding, Electrical, PLC (comma-separated)').fill('Mechanical, Alignment');
    await page.getByPlaceholder('Multimeter, Torque Wrench (comma-separated)').fill('Torque Wrench, Dial Gauge');
    const updateTemplate = page.waitForResponse((response) =>
      response.url().includes(`/api/pm-templates/${templateId}`)
      && response.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: 'Update Template', exact: true }).click();
    expect((await updateTemplate).status()).toBe(200);

    const edited = await apiCall(plannerToken, 'GET', `/api/pm-templates/${templateId}`);
    expect(edited.status).toBe(200);
    expect(Number(edited.data.data?.estimatedDuration)).toBe(1.75);
    expect(JSON.parse(edited.data.data?.requiredSkills || '[]')).toEqual(['Mechanical', 'Alignment']);
    expect(JSON.parse(edited.data.data?.requiredTools || '[]')).toEqual(['Torque Wrench', 'Dial Gauge']);

    // Re-open and remove one of two tasks. Soft removal is valid because one active task remains.
    await page.getByPlaceholder('Search templates...').fill(templateTitle);
    const rowAfterEdit = page.getByRole('row').filter({ hasText: templateTitle });
    await rowAfterEdit.hover();
    await rowAfterEdit.getByRole('button').last().click();
    await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
    await page.getByRole('button', { name: /Task Library Checklist/i }).click();
    await expect(page.getByText(`Task Description: ${firstTask}`, { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(`Task Description: ${lastTask}`, { exact: true })).toBeVisible({ timeout: 10_000 });

    const firstTaskRow = page.getByText(`Task Description: ${firstTask}`, { exact: true }).locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
    await firstTaskRow.getByRole('button', { name: 'Remove from Template', exact: true }).click();
    const firstDelete = page.waitForResponse((response) =>
      response.url().includes(`/api/pm-templates/${templateId}/tasks/`)
      && response.request().method() === 'DELETE',
    );
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove from Template', exact: true }).click();
    expect((await firstDelete).status()).toBe(200);
    await expect(page.getByText(`Task Description: ${firstTask}`, { exact: true })).toHaveCount(0);

    // The last active task is protected while an active schedule still depends on this template.
    const lastTaskRow = page.getByText(`Task Description: ${lastTask}`, { exact: true }).locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
    await lastTaskRow.getByRole('button', { name: 'Remove from Template', exact: true }).click();
    const blockedLastDelete = page.waitForResponse((response) =>
      response.url().includes(`/api/pm-templates/${templateId}/tasks/`)
      && response.request().method() === 'DELETE',
    );
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove from Template', exact: true }).click();
    expect((await blockedLastDelete).status()).toBe(409);
    await expect(page.getByText(`Task Description: ${lastTask}`, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    // Template deactivation is also blocked while the linked schedule remains active.
    await page.getByPlaceholder('Search templates...').fill(templateTitle);
    const blockedTemplateRow = page.getByRole('row').filter({ hasText: templateTitle });
    await blockedTemplateRow.hover();
    await blockedTemplateRow.getByRole('button').last().click();
    const blockedDeactivate = page.waitForResponse((response) =>
      response.url().includes(`/api/pm-templates/${templateId}`)
      && response.request().method() === 'PUT'
      && response.request().postDataJSON()?.isActive === false,
    );
    await page.getByRole('menuitem', { name: 'Deactivate', exact: true }).click();
    expect((await blockedDeactivate).status()).toBe(409);
    const stillActive = await apiCall(plannerToken, 'GET', `/api/pm-templates/${templateId}`);
    expect(stillActive.data.data?.isActive).toBe(true);
    expect(stillActive.data.data?.tasks).toHaveLength(1);

    // Deactivate the schedule from the real schedule UI, then template deactivation becomes valid.
    await page.goto('/#/pm-schedules');
    await expect(page.getByRole('main').getByRole('heading', { name: 'PM Schedules', exact: true })).toBeVisible({ timeout: 20_000 });
    const scheduleRow = page.getByRole('row').filter({ hasText: scheduleTitle });
    await expect(scheduleRow).toBeVisible({ timeout: 15_000 });
    await scheduleRow.hover();
    await scheduleRow.getByRole('button').last().click();
    const scheduleDeactivate = page.waitForResponse((response) =>
      response.url().includes(`/api/pm-schedules/${scheduleId}`)
      && response.request().method() === 'DELETE',
    );
    await page.getByRole('menuitem', { name: 'Deactivate', exact: true }).click();
    expect((await scheduleDeactivate).status()).toBe(200);

    const scheduleState = await apiCall(plannerToken, 'GET', `/api/pm-schedules/${scheduleId}`);
    expect(scheduleState.status).toBe(200);
    expect(scheduleState.data.data?.isActive).toBe(false);

    // Inactive schedules remain governable: reactivate through the UI, verify, then deactivate again.
    const inactiveScheduleRow = page.getByRole('row').filter({ hasText: scheduleTitle });
    await inactiveScheduleRow.hover();
    await inactiveScheduleRow.getByRole('button').last().click();
    const scheduleReactivate = page.waitForResponse((response) =>
      response.url().includes(`/api/pm-schedules/${scheduleId}`)
      && response.request().method() === 'PUT'
      && response.request().postDataJSON()?.isActive === true,
    );
    await page.getByRole('menuitem', { name: 'Activate', exact: true }).click();
    expect((await scheduleReactivate).status()).toBe(200);
    const reactivatedSchedule = await apiCall(plannerToken, 'GET', `/api/pm-schedules/${scheduleId}`);
    expect(reactivatedSchedule.data.data?.isActive).toBe(true);

    const reactivatedRow = page.getByRole('row').filter({ hasText: scheduleTitle });
    await reactivatedRow.hover();
    await reactivatedRow.getByRole('button').last().click();
    const secondDeactivate = page.waitForResponse((response) =>
      response.url().includes(`/api/pm-schedules/${scheduleId}`)
      && response.request().method() === 'DELETE',
    );
    await page.getByRole('menuitem', { name: 'Deactivate', exact: true }).click();
    expect((await secondDeactivate).status()).toBe(200);

    await page.goto('/#/pm-templates');
    await page.getByPlaceholder('Search templates...').fill(templateTitle);
    const activeTemplateRow = page.getByRole('row').filter({ hasText: templateTitle });
    await activeTemplateRow.hover();
    await activeTemplateRow.getByRole('button').last().click();
    const allowedDeactivate = page.waitForResponse((response) =>
      response.url().includes(`/api/pm-templates/${templateId}`)
      && response.request().method() === 'PUT'
      && response.request().postDataJSON()?.isActive === false,
    );
    await page.getByRole('menuitem', { name: 'Deactivate', exact: true }).click();
    expect((await allowedDeactivate).status()).toBe(200);

    // Inactive templates are hidden by default; reveal and reactivate through the UI.
    await expect(page.getByText(templateTitle, { exact: true })).toHaveCount(0);
    await page.getByRole('switch').click();
    await expect(page.getByText(templateTitle, { exact: true })).toBeVisible({ timeout: 15_000 });
    const inactiveTemplateRow = page.getByRole('row').filter({ hasText: templateTitle });
    await inactiveTemplateRow.hover();
    await inactiveTemplateRow.getByRole('button').last().click();
    const reactivate = page.waitForResponse((response) =>
      response.url().includes(`/api/pm-templates/${templateId}`)
      && response.request().method() === 'PUT'
      && response.request().postDataJSON()?.isActive === true,
    );
    await page.getByRole('menuitem', { name: 'Activate', exact: true }).click();
    expect((await reactivate).status()).toBe(200);

    const finalTemplate = await apiCall(plannerToken, 'GET', `/api/pm-templates/${templateId}`);
    expect(finalTemplate.status).toBe(200);
    expect(finalTemplate.data.data?.isActive).toBe(true);
    expect(finalTemplate.data.data?.tasks).toHaveLength(1);
    expect(finalTemplate.data.data?.tasks?.[0]?.description).toBe(lastTask);
  } finally {
    if (scheduleId) await apiCall(plannerToken, 'PUT', `/api/pm-schedules/${scheduleId}`, { isActive: false });
    if (templateId) await apiCallWithPlant(plannerToken, 'PUT', `/api/pm-templates/${templateId}`, plantId, { isActive: false });
  }
});
