import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

const { mockDb, mockCreateAuditLog, mockNotifyUser } = vi.hoisted(() => ({
  mockDb: {
    damagedToolReport: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    tool: { update: vi.fn(), updateMany: vi.fn() },
    toolTransaction: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  mockCreateAuditLog: vi.fn(),
  mockNotifyUser: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(() => ({ userId: 'store-1', roles: ['store_keeper'] })),
  isAdmin: vi.fn(() => false),
  hasRole: vi.fn((_session: unknown, role: string) => role === 'store_keeper'),
}));
vi.mock('@/lib/audit', () => ({ createAuditLog: mockCreateAuditLog }));
vi.mock('@/lib/notifications', () => ({ notifyUser: mockNotifyUser }));
vi.mock('@/lib/plant-scope', () => ({
  getPlantScope: vi.fn(async () => ({ unrestricted: true, denyAccess: false })),
  canAccessPlantStrict: vi.fn(() => true),
}));

import { POST } from '@/app/api/repairs/damaged-tools/[id]/route';

const existing = {
  id: 'dtr-1',
  reportNumber: 'DTR-202610-0001',
  toolId: 'tool-1',
  workOrderId: 'wo-1',
  toolRequestId: 'tr-1',
  quantity: 1,
  repairHeldQuantity: 1,
  damageType: 'broken',
  damageSeverity: 'high',
  damageDescription: 'Cracked ratchet',
  status: 'repair_in_progress',
  actualRepairCost: null,
  estimatedRepairCost: 100,
  reportedById: 'tech-1',
  technicianId: 'tech-1',
  workOrder: { id: 'wo-1', woNumber: 'WO-1', title: 'Repair pump', plantId: 'plant-a' },
  reportedBy: { id: 'tech-1', fullName: 'Tech One' },
  technician: { id: 'tech-1', fullName: 'Tech One' },
  tool: { id: 'tool-1', name: 'Torque Wrench', toolCode: 'TL-1', quantity: 1, repairQuantity: 1, status: 'available', condition: 'good' },
};

function request(action: string, extra: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/repairs/damaged-tools/dtr-1', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...extra }),
  });
}

const params = { params: Promise.resolve({ id: 'dtr-1' }) };

describe('damaged tool repair QC custody', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mockDb.damagedToolReport.findUnique as Mock).mockResolvedValue(existing);
    (mockDb.$transaction as Mock).mockImplementation(async (arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      return (arg as (tx: typeof mockDb) => Promise<unknown>)(mockDb);
    });
    (mockDb.damagedToolReport.update as Mock).mockResolvedValue({ ...existing, status: 'awaiting_qc' });
    (mockDb.damagedToolReport.updateMany as Mock).mockResolvedValue({ count: 1 });
    (mockDb.tool.updateMany as Mock).mockResolvedValue({ count: 1 });
    (mockDb.tool.update as Mock).mockResolvedValue({ ...existing.tool });
    (mockDb.toolTransaction.create as Mock).mockResolvedValue({ id: 'txn-1' });
    mockCreateAuditLog.mockResolvedValue(undefined);
    mockNotifyUser.mockResolvedValue(undefined);
  });

  it('complete_repair quarantines the repaired quantity for QC instead of releasing usable stock', async () => {
    const response = await POST(request('complete_repair', { actualRepairCost: 80 }), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe('awaiting_qc');
    expect(mockDb.tool.update).not.toHaveBeenCalled();
    expect(mockDb.tool.updateMany).not.toHaveBeenCalled();
  });

  it('accept_repair releases only the report held quantity back to usable stock', async () => {
    (mockDb.damagedToolReport.findUnique as Mock)
      .mockResolvedValueOnce({ ...existing, status: 'awaiting_qc' })
      .mockResolvedValueOnce({ ...existing, status: 'repaired', repairHeldQuantity: 0 });
    (mockDb.damagedToolReport.update as Mock).mockResolvedValue({ ...existing, status: 'repaired', repairHeldQuantity: 0 });

    const response = await POST(request('accept_repair', { qcNotes: 'Function tested and accepted' }), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe('repaired');
    expect(mockDb.tool.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'tool-1', repairQuantity: 1 }),
      data: expect.objectContaining({
        quantity: { increment: 1 },
        repairQuantity: { decrement: 1 },
        status: 'available',
      }),
    }));
  });
});

describe('damaged tool terminal quantity custody', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mockDb.$transaction as Mock).mockImplementation(async (arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      return (arg as (tx: typeof mockDb) => Promise<unknown>)(mockDb);
    });
    (mockDb.damagedToolReport.update as Mock).mockResolvedValue({ ...existing, status: 'written_off', repairHeldQuantity: 0 });
    (mockDb.damagedToolReport.updateMany as Mock).mockResolvedValue({ count: 1 });
    (mockDb.tool.updateMany as Mock).mockResolvedValue({ count: 1 });
    (mockDb.tool.update as Mock).mockResolvedValue(existing.tool);
    (mockDb.toolTransaction.create as Mock).mockResolvedValue({ id: 'txn-1' });
    mockCreateAuditLog.mockResolvedValue(undefined);
    mockNotifyUser.mockResolvedValue(undefined);
  });

  it.each(['quote_repair', 'write_off', 'replace'])('%s cannot advance an operational damage report before physical repair custody is confirmed', async (action) => {
    (mockDb.damagedToolReport.findUnique as Mock).mockResolvedValue({
      ...existing,
      status: 'assessed',
      workOrderId: 'wo-1',
      toolRequestId: null,
      repairHeldQuantity: 0,
      tool: { ...existing.tool, quantity: 2, repairQuantity: 0, status: 'available' },
    });

    const response = await POST(request(action, {
      repairVendorName: 'Workshop', estimatedRepairCost: 40,
      writeOffReason: 'Uneconomical', replacedWithToolId: 'tool-2',
    }), params);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toContain('physical return');
    expect(mockDb.tool.update).not.toHaveBeenCalled();
    expect(mockDb.tool.updateMany).not.toHaveBeenCalled();
  });

  it('write_off removes only the held damaged quantity and keeps serviceable stock active', async () => {
    (mockDb.damagedToolReport.findUnique as Mock).mockResolvedValue({ ...existing, status: 'assessed' });

    const response = await POST(request('write_off', { writeOffReason: 'Repair uneconomical' }), params);
    expect(response.status).toBe(200);
    expect(mockDb.tool.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'tool-1', repairQuantity: 1 }),
      data: expect.objectContaining({ repairQuantity: { decrement: 1 }, status: 'available' }),
    }));
    expect(mockDb.tool.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'retired' } }));
  });

  it('replace does not rewrite replacement tool custody outside the damaged-unit transaction', async () => {
    (mockDb.damagedToolReport.findUnique as Mock).mockResolvedValue({ ...existing, status: 'assessed' });
    (mockDb.damagedToolReport.update as Mock).mockResolvedValue({ ...existing, status: 'replaced', repairHeldQuantity: 0, replacedWithToolId: 'tool-2' });

    const response = await POST(request('replace', { replacedWithToolId: 'tool-2' }), params);
    expect(response.status).toBe(200);
    expect(mockDb.tool.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'tool-2' } }));
    expect(mockDb.tool.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'tool-1', repairQuantity: 1 }),
      data: expect.objectContaining({ repairQuantity: { decrement: 1 }, status: 'available' }),
    }));
  });
});
