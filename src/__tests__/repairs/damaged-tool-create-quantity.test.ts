import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

const { mockDb, mockAudit, mockNotify, mockCanAccessPlantStrict } = vi.hoisted(() => ({
  mockDb: {
    damagedToolReport: { findFirst: vi.fn(), create: vi.fn() },
    tool: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    toolTransaction: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  mockAudit: vi.fn(),
  mockNotify: vi.fn(),
  mockCanAccessPlantStrict: vi.fn(() => true),
}));
vi.mock('@/lib/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(() => ({ userId: 'store-1', roles: ['store_keeper'] })),
  isAdmin: vi.fn(() => false),
  hasRole: vi.fn((_session: unknown, role: string) => role === 'store_keeper'),
}));
vi.mock('@/lib/audit', () => ({ createAuditLog: mockAudit }));
vi.mock('@/lib/notifications', () => ({ notifyUser: mockNotify }));
vi.mock('@/lib/plant-scope', () => ({
  getPlantScope: vi.fn(async () => ({ unrestricted: true, denyAccess: false })),
  applyPlantScope: vi.fn((where: unknown) => where),
  canAccessPlantStrict: mockCanAccessPlantStrict,
}));

import { POST } from '@/app/api/repairs/damaged-tools/route';

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/repairs/damaged-tools', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('manual damaged tool report quantity custody', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mockDb.damagedToolReport.findFirst as Mock).mockResolvedValue(null);
    (mockDb.tool.findUnique as Mock).mockResolvedValue({
      id: 'tool-1', toolCode: 'TL-1', name: 'Torque Wrench', plantId: 'plant-a',
      status: 'available', condition: 'good', quantity: 3, repairQuantity: 0, assignedToId: null,
      assignedTo: null,
    });
    (mockDb.damagedToolReport.create as Mock).mockResolvedValue({ id: 'dtr-1', reportNumber: 'DTR-202610-0001', quantity: 1, repairHeldQuantity: 1 });
    (mockDb.tool.update as Mock).mockResolvedValue({});
    (mockDb.tool.updateMany as Mock).mockResolvedValue({ count: 1 });
    (mockDb.toolTransaction.create as Mock).mockResolvedValue({});
    (mockDb.$transaction as Mock).mockImplementation(async (arg: unknown) => Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: typeof mockDb) => Promise<unknown>)(mockDb));
    mockAudit.mockResolvedValue(undefined);
    mockNotify.mockResolvedValue(undefined);
    mockCanAccessPlantStrict.mockReturnValue(true);
  });

  it('quarantines only the reported store-held quantity and keeps remaining usable units available', async () => {
    const response = await POST(request({
      toolId: 'tool-1', quantity: 1, damageType: 'broken', damageSeverity: 'high', damageDescription: 'Cracked ratchet head',
    }));
    expect(response.status).toBe(201);
    expect(mockDb.damagedToolReport.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ quantity: 1, repairHeldQuantity: 1 }),
    }));
    expect(mockDb.tool.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'tool-1', quantity: 3, repairQuantity: 0 }),
      data: expect.objectContaining({ quantity: { decrement: 1 }, repairQuantity: { increment: 1 }, status: 'available' }),
    }));
    expect(mockDb.tool.update).not.toHaveBeenCalled();
  });

  it('records operational damage without removing another store unit before physical return', async () => {
    const response = await POST(request({
      toolId: 'tool-1', workOrderId: 'wo-1', quantity: 1, damageType: 'broken', damageDescription: 'Damaged during work',
    }));
    expect(response.status).toBe(201);
    expect(mockDb.damagedToolReport.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ quantity: 1, repairHeldQuantity: 0, workOrderId: 'wo-1' }),
    }));
    expect(mockDb.tool.updateMany).not.toHaveBeenCalled();
    expect(mockDb.tool.update).not.toHaveBeenCalled();
  });

  it('denies manual damage/quarantine for a tool outside the actor plant scope', async () => {
    mockCanAccessPlantStrict.mockReturnValue(false);
    const response = await POST(request({
      toolId: 'tool-1', quantity: 1, damageType: 'broken', damageDescription: 'Cross-plant attempt',
    }));
    expect(response.status).toBe(403);
    expect(mockDb.damagedToolReport.create).not.toHaveBeenCalled();
    expect(mockDb.tool.updateMany).not.toHaveBeenCalled();
  });

  it('rejects quarantine quantity above usable store stock', async () => {
    const response = await POST(request({
      toolId: 'tool-1', quantity: 4, damageType: 'broken', damageDescription: 'Batch damage',
    }));
    expect(response.status).toBe(400);
    expect(mockDb.damagedToolReport.create).not.toHaveBeenCalled();
  });
});
