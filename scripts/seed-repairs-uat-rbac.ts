/*
 * seed-repairs-uat-rbac.ts — Canonical RBAC fixture for Repairs/RWOP UAT.
 *
 * The base UAT seed intentionally creates real users, roles, plants, assets and
 * workflow data. This companion seed creates Permission + RolePermission rows
 * for the canonical production roles carried by those users. Alias roles such
 * as requester/planner/team_leader/storekeeper remain lifecycle/test lookup
 * aliases only; they do not receive test-only authorization grants.
 *
 * Keep these grants aligned with the corresponding canonical bundles in
 * prisma/seed.ts. The goal is to exercise production RBAC, not bypass it.
 */

import { PrismaClient } from '@prisma/client';

if (!process.env.DATABASE_URL || !/^postgres(?:ql)?:\/\//i.test(process.env.DATABASE_URL)) {
  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || '5432';
  const user = process.env.DB_USER || 'postgres';
  const password = process.env.DB_PASSWORD || '';
  const database = process.env.DB_NAME || 'iassetspro';
  process.env.DATABASE_URL = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}?schema=public`;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createAdapter } = require('../src/lib/create-postgres-adapter');
const db = new PrismaClient({ adapter: createAdapter(process.env.DATABASE_URL) });

const ROLE_PERMISSIONS: Record<string, string[]> = {
  production_operator: [
    'dashboard.view', 'chat.view',
    'documents.view', 'documents.download',
    'notifications.view',
    'assets.view', 'assets.view_own',
    'equipment.view',
    'production.view',
    'production_surveys.view', 'production_surveys.create', 'production_surveys.update',
    'downtime.view', 'downtime.create',
    'quality_checks.view',
    'maintenance_requests.view_own', 'maintenance_requests.create',
    'work_orders.view_own',
    'time_logs.view', 'time_logs.create',
  ],

  production_manager: [
    'dashboard.view', 'dashboard.stats', 'chat.view',
    'documents.view', 'documents.upload', 'documents.download',
    'notifications.view', 'notifications.manage',
    'assets.view', 'assets.view_all', 'assets.health', 'assets.criticality',
    'equipment.view', 'facilities.view',
    'work_centers.view', 'work_centers.create', 'work_centers.update',
    'production.view', 'production.create', 'production.update', 'production.manage',
    'production_surveys.view', 'production_surveys.create', 'production_surveys.update', 'production_surveys.manage',
    'oee.view', 'oee.manage',
    'downtime.view', 'downtime.create', 'downtime.manage',
    'quality_checks.view', 'quality_checks.create', 'quality_checks.update',
    'energy.view', 'energy.manage',
    'production_targets.view', 'production_targets.create', 'production_targets.update',
    'production_batches.view', 'production_batches.create', 'production_batches.update', 'production_batches.delete',
    'maintenance_requests.view', 'maintenance_requests.view_all', 'maintenance_requests.create',
    'work_orders.view', 'work_orders.view_all',
    'inventory.view', 'inventory.view_all',
    'employees.view', 'shifts.view', 'assignments.view',
    'reports.view', 'reports.export', 'reports.generate', 'reports.create',
    'analytics.view', 'operations.view',
  ],

  maintenance_planner: [
    'dashboard.view', 'dashboard.stats', 'chat.view',
    'documents.view', 'documents.upload', 'documents.download',
    'notifications.view',
    'assets.view', 'assets.view_all', 'assets.create', 'assets.update',
    'assets.hierarchy', 'assets.health', 'assets.criticality',
    'equipment.view', 'equipment.create', 'equipment.update',
    'assemblies.view', 'assemblies.create', 'assemblies.update',
    'bom.view', 'bom.create', 'bom.update',
    'facilities.view',
    'meters.view', 'meters.read',
    'tools.view',
    'maintenance_requests.view', 'maintenance_requests.view_all', 'maintenance_requests.create',
    'maintenance_requests.update', 'maintenance_requests.triage',
    'maintenance_requests.convert_to_wo', 'maintenance_requests.my_queue',
    'work_orders.view', 'work_orders.view_all', 'work_orders.create', 'work_orders.update',
    'work_orders.assign_supervisor', 'work_orders.assign_technician',
    'work_orders.close', 'work_orders.failure_analysis', 'work_orders.dashboard',
    'work_orders.bulk_update', 'work_orders.cancel',
    'work_order_templates.view', 'work_order_templates.create', 'work_order_templates.update',
    'recurring_work_orders.view', 'recurring_work_orders.create', 'recurring_work_orders.update',
    'approvals.view',
    'verifications.view',
    'sla.view', 'sla.manage',
    'failure_codes.view', 'failure_codes.manage',
    'rca.view', 'rca.create', 'rca.update',
    'time_logs.view',
    'pm_schedules.view', 'pm_schedules.create', 'pm_schedules.update', 'pm_schedules.delete',
    'pm_schedules.activate', 'pm_schedules.run',
    'pm_templates.view', 'pm_templates.create', 'pm_templates.update', 'pm_templates.delete',
    'pm_tasks.view', 'pm_tasks.create', 'pm_tasks.update', 'pm_tasks.delete', 'pm_tasks.import',
    'pm_triggers.view', 'pm_triggers.create', 'pm_triggers.update',
    'pm_checklists.view', 'pm_checklists.create', 'pm_checklists.update', 'pm_checklists.delete',
    'pm_notifications.view', 'pm_analytics.view', 'pm_work_orders.view',
    'calibration.view', 'calibration.create', 'calibration.update',
    'asset_health.view', 'condition_monitoring.view',
    'inventory.view',
    'parts.view',
    'repair_material_requests.view', 'repair_material_requests.view_all', 'repair_material_requests.update',
    'repair_tool_requests.view', 'repair_tool_requests.view_all', 'repair_tool_requests.update',
    'repair_tool_transfers.view', 'repair_tool_transfers.view_all', 'repair_tool_transfers.update',
    'spare_part_returns.view', 'spare_part_returns.view_all', 'spare_part_returns.update',
    'damaged_tool_reports.view', 'damaged_tool_reports.view_all', 'damaged_tool_reports.update',
    'reports.view', 'reports.export', 'reports.generate',
    'analytics.view', 'operations.view',
  ],

  maintenance_supervisor: [
    'dashboard.view', 'chat.view',
    'documents.view', 'documents.upload', 'documents.download',
    'notifications.view',
    'assets.view', 'assets.view_all', 'assets.update',
    'assets.health', 'assets.criticality',
    'equipment.view',
    'meters.view', 'meters.read',
    'tools.view',
    'maintenance_requests.view', 'maintenance_requests.view_all',
    'maintenance_requests.update', 'maintenance_requests.approve', 'maintenance_requests.reject',
    'maintenance_requests.assign_planner',
    'work_orders.view', 'work_orders.view_all', 'work_orders.update',
    'work_orders.assign_technician', 'work_orders.complete', 'work_orders.verify',
    'work_orders.reopen', 'work_orders.dashboard',
    'work_order_templates.view',
    'approvals.view', 'approvals.approve', 'approvals.reject',
    'verifications.view', 'verifications.check',
    'sla.view',
    'failure_codes.view',
    'rca.view', 'rca.create', 'rca.update',
    'assistance_requests.view', 'assistance_requests.create', 'assistance_requests.respond',
    'time_logs.view', 'time_logs.create', 'time_logs.update',
    'pm_schedules.view', 'pm_schedules.activate',
    'pm_checklists.view',
    'pm_notifications.view',
    'calibration.view',
    'asset_health.view', 'condition_monitoring.view',
    'inventory.view',
    'repair_material_requests.view', 'repair_material_requests.view_all', 'repair_material_requests.update',
    'repair_tool_requests.view', 'repair_tool_requests.view_all', 'repair_tool_requests.update',
    'repair_tool_transfers.view', 'repair_tool_transfers.view_all', 'repair_tool_transfers.update',
    'spare_part_returns.view', 'spare_part_returns.view_all', 'spare_part_returns.update',
    'damaged_tool_reports.view', 'damaged_tool_reports.view_all', 'damaged_tool_reports.update',
    'reports.view', 'reports.export',
    'operations.view',
  ],

  maintenance_technician: [
    'dashboard.view', 'chat.view',
    'documents.view', 'documents.download',
    'notifications.view',
    'assets.view', 'assets.view_own',
    'equipment.view',
    'meters.view', 'meters.read',
    'tools.view', 'tools.checkout', 'tools.return',
    'maintenance_requests.view_own',
    'maintenance_requests.create', 'maintenance_requests.update',
    'work_orders.view_own', 'work_orders.update',
    'work_orders.start', 'work_orders.complete',
    'assistance_requests.view', 'assistance_requests.create',
    'time_logs.view', 'time_logs.create', 'time_logs.update',
    'pm_schedules.view', 'pm_schedules.run',
    'pm_checklists.view',
    'pm_notifications.view',
    'inventory.view',
    'parts.view',
    'repair_tool_requests.view_own', 'repair_tool_requests.create',
    'repair_material_requests.view_own', 'repair_material_requests.create',
    'repair_tool_transfers.view_own', 'repair_tool_transfers.create',
    'spare_part_returns.view_own', 'spare_part_returns.create',
    'damaged_tool_reports.create',
  ],

  inventory_manager: [
    'dashboard.view', 'dashboard.stats', 'chat.view',
    'documents.view', 'documents.upload', 'documents.download',
    'notifications.view', 'notifications.manage',
    'inventory.view', 'inventory.view_all', 'inventory.create', 'inventory.update',
    'inventory.delete', 'inventory.stock_in', 'inventory.stock_out', 'inventory.reserve',
    'inventory.consume', 'inventory.export', 'inventory.manage', 'inventory.forecast',
    'parts.view', 'parts.create', 'parts.update', 'parts.delete',
    'parts_categories.view', 'parts_categories.create', 'parts_categories.update',
    'material_requisitions.view', 'material_requisitions.create', 'material_requisitions.update', 'material_requisitions.approve',
    'material_requisitions.issue', 'material_requisitions.reject',
    'vendors.view', 'vendors.create', 'vendors.update', 'vendors.delete', 'vendors.manage',
    'stock_transactions.view',
    'purchase_orders.view', 'purchase_orders.create', 'purchase_orders.update',
    'purchase_orders.approve', 'purchase_orders.receive', 'purchase_orders.manage',
    'inventory_locations.view', 'inventory_locations.create', 'inventory_locations.update',
    'inventory_locations.delete',
    'inventory_adjustments.view', 'inventory_adjustments.create', 'inventory_adjustments.update', 'inventory_adjustments.approve',
    'inventory_transfers.view', 'inventory_transfers.create', 'inventory_transfers.update', 'inventory_transfers.approve',
    'assets.view', 'work_orders.view', 'work_orders.view_all',
    'maintenance_requests.view',
    'spare_part_returns.view_all', 'spare_part_returns.update',
    'reports.view', 'reports.export', 'reports.generate',
    'analytics.view',
  ],

  tools_shop_attendant: [
    'dashboard.view', 'chat.view',
    'documents.view', 'documents.download',
    'notifications.view',
    'tools.view', 'tools.create', 'tools.update', 'tools.delete',
    'tools.manage', 'tools.checkout', 'tools.return', 'tools.transfer',
    'assets.view',
    'equipment.view',
    'work_orders.view', 'work_orders.view_all',
    'maintenance_requests.view', 'maintenance_requests.view_all',
    'inventory.view',
    'parts.view',
    'repair_material_requests.view', 'repair_material_requests.view_all',
    'repair_tool_requests.view', 'repair_tool_requests.view_all',
    'repair_tool_transfers.view', 'repair_tool_transfers.view_all',
    'reports.view', 'reports.export',
    'employees.view',
  ],

  store_keeper: [
    'dashboard.view', 'chat.view',
    'documents.view', 'documents.download',
    'notifications.view',
    'inventory.view', 'inventory.stock_in', 'inventory.stock_out',
    'inventory.reserve', 'inventory.export',
    'parts.view', 'parts.update',
    'parts_categories.view',
    'material_requisitions.view', 'material_requisitions.issue',
    'vendors.view',
    'stock_transactions.view',
    'purchase_orders.view', 'purchase_orders.receive',
    'inventory_locations.view',
    'inventory_adjustments.view', 'inventory_adjustments.create', 'inventory_adjustments.update',
    'inventory_transfers.view', 'inventory_transfers.update',
    'repair_tool_transfers.view_all', 'repair_tool_transfers.update',
    'repair_tool_requests.view_all', 'repair_tool_requests.update',
    'repair_material_requests.view_all', 'repair_material_requests.update',
    'spare_part_returns.view_all', 'spare_part_returns.update',
    'damaged_tool_reports.view_all', 'damaged_tool_reports.update',
    'reports.view',
  ],
};

function titleCase(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

async function ensurePermission(slug: string) {
  const dot = slug.indexOf('.');
  if (dot <= 0 || dot === slug.length - 1) {
    throw new Error(`Invalid permission slug: ${slug}`);
  }

  const permissionModule = slug.slice(0, dot);
  const action = slug.slice(dot + 1);
  return db.permission.upsert({
    where: { slug },
    update: {
      module: permissionModule,
      action,
    },
    create: {
      slug,
      name: `${titleCase(permissionModule)} - ${titleCase(action)}`,
      module: permissionModule,
      action,
      description: `UAT canonical permission for ${slug}`,
    },
  });
}

async function grantCanonicalRole(roleSlug: string, permissionSlugs: string[]) {
  const role = await db.role.findUnique({
    where: { slug: roleSlug },
    select: { id: true },
  });
  if (!role) {
    throw new Error(`Canonical UAT role is missing: ${roleSlug}`);
  }

  for (const slug of permissionSlugs) {
    const permission = await ensurePermission(slug);
    await db.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: role.id,
          permissionId: permission.id,
        },
      },
      update: {},
      create: {
        roleId: role.id,
        permissionId: permission.id,
      },
    });
  }

  const grantedCount = await db.rolePermission.count({ where: { roleId: role.id } });
  console.log(`   ${roleSlug}: ${grantedCount} permission(s)`);
}

async function main() {
  console.log('🔐 Seeding Repairs UAT canonical RBAC...');

  for (const [roleSlug, permissionSlugs] of Object.entries(ROLE_PERMISSIONS)) {
    await grantCanonicalRole(roleSlug, permissionSlugs);
  }

  const required = [
    ['production_operator', 'maintenance_requests.create'],
    ['production_manager', 'work_centers.create'],
    ['maintenance_planner', 'maintenance_requests.convert_to_wo'],
    ['maintenance_planner', 'pm_tasks.create'],
    ['maintenance_supervisor', 'maintenance_requests.approve'],
    ['maintenance_technician', 'work_orders.start'],
    ['inventory_manager', 'vendors.create'],
    ['inventory_manager', 'purchase_orders.approve'],
    ['inventory_manager', 'spare_part_returns.update'],
    ['tools_shop_attendant', 'tools.create'],
    ['store_keeper', 'repair_material_requests.update'],
  ] as const;

  for (const [roleSlug, permissionSlug] of required) {
    const grant = await db.rolePermission.findFirst({
      where: {
        role: { slug: roleSlug },
        permission: { slug: permissionSlug },
      },
      select: { id: true },
    });
    if (!grant) {
      throw new Error(`RBAC seed verification failed: ${roleSlug} lacks ${permissionSlug}`);
    }
  }

  console.log('✅ Repairs UAT canonical RBAC seeded and verified.');
}

main()
  .catch((error) => {
    console.error('❌ Repairs UAT RBAC seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
