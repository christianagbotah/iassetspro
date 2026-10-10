import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    tool: { findUnique: vi.fn(), update: vi.fn() },
    toolTransaction: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));
vi.mock('@/lib/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(() => ({ userId: 'store-1' })),
  hasPermission: vi.fn(() => true),
  isAdmin: vi.fn(() => false),
}));
import { POST } from '@/app/api/tools/[id]/repair/route';

const params = { params: Promise.resolve({ id: 'tool-1' }) };
function request(body: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/tools/tool-1/repair', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('legacy tool repair endpoint custody boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (mockDb.tool.update as Mock).mockResolvedValue({});
    (mockDb.toolTransaction.create as Mock).mockResolvedValue({});
    (mockDb.auditLog.create as Mock).mockResolvedValue({});
  });

  it('rejects aggregate tool repair because quantity custody belongs to damaged-tool workflow', async () => {
    (mockDb.tool.findUnique as Mock).mockResolvedValue({ id: 'tool-1', status: 'available', quantity: 3, repairQuantity: 0, assignedToId: null });
    const response = await POST(request({ notes: 'One ratchet damaged' }), params);
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toContain('damaged tool');
    expect(mockDb.tool.update).not.toHaveBeenCalled();
  });

  it('rejects direct repair when quantity-aware repair custody already exists', async () => {
    (mockDb.tool.findUnique as Mock).mockResolvedValue({ id: 'tool-1', status: 'available', quantity: 1, repairQuantity: 1, assignedToId: null });
    const response = await POST(request(), params);
    expect(response.status).toBe(400);
    expect(mockDb.tool.update).not.toHaveBeenCalled();
  });
});
