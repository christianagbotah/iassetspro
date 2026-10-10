import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    tool: { findUnique: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock('@/lib/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(() => ({ userId: 'admin-1' })),
  hasPermission: vi.fn(() => true),
  isAdmin: vi.fn(() => true),
}));

import { PUT } from '@/app/api/tools/[id]/route';

const params = { params: Promise.resolve({ id: 'tool-1' }) };
const existing = { id: 'tool-1', toolCode: 'TL-1', status: 'available', quantity: 3, repairQuantity: 0, isActive: true };

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/tools/tool-1', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('tool edit custody boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mockDb.tool.findUnique as Mock).mockResolvedValue(existing);
    (mockDb.tool.update as Mock).mockResolvedValue(existing);
    (mockDb.auditLog.create as Mock).mockResolvedValue({});
  });

  it.each(['quantity', 'repairQuantity', 'status', 'condition', 'assignedToId', 'expectedReturn'])('%s cannot be mutated through generic tool edit', async (field) => {
    const response = await PUT(request({ name: 'Torque Wrench', [field]: field.includes('Quantity') || field === 'quantity' ? 99 : 'bypass' }), params);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('custody');
    expect(mockDb.tool.update).not.toHaveBeenCalled();
  });

  it('still allows descriptive tool metadata updates', async () => {
    (mockDb.tool.update as Mock).mockResolvedValue({ ...existing, name: 'Torque Wrench 1/2in' });
    const response = await PUT(request({ name: 'Torque Wrench 1/2in', manufacturer: 'Proto' }), params);

    expect(response.status).toBe(200);
    expect(mockDb.tool.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { name: 'Torque Wrench 1/2in', manufacturer: 'Proto' },
    }));
  });
});
