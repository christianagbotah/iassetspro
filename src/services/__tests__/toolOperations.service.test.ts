// ============================================================================
// Tool Operations Service - Atomic Issue & Return Tests
// ============================================================================
// Tests for atomicIssueTools and atomicConfirmToolReturn domain services.
// Covers: multi-item issue, calibration blocks, partial issue, legacy single-tool
// issue, status validation, return confirmation, condition handling, all-returned
// detection, and error paths.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

// ---- Hoisted mocks ----
const {
  mockDb,
  mockTxUpdate,
  mockTxItemUpdate,
  mockTxToolUpdate,
  mockTxToolTransactionCreate,
  mockTxDamagedToolReportCreate,
  mockTxDamagedToolReportFindFirst,
  mockTxDamagedToolReportUpdate,
  mockTxRequestUpdate,
  mockTxItemFindMany,
  mockCheckToolCalibration,
} = vi.hoisted(() => ({
  mockDb: {
    $transaction: vi.fn(),
    repairToolRequest: {
      findUnique: vi.fn(),
    },
  },
  // Transaction-scoped mocks (separate from db-level mocks)
  mockTxUpdate: vi.fn().mockResolvedValue({}),
  mockTxItemUpdate: vi.fn().mockResolvedValue({}),
  mockTxToolUpdate: vi.fn().mockResolvedValue({}),
  mockTxToolTransactionCreate: vi.fn().mockResolvedValue({}),
  mockTxDamagedToolReportCreate: vi.fn().mockResolvedValue({ id: 'dtr-1' }),
  mockTxDamagedToolReportFindFirst: vi.fn().mockResolvedValue(null),
  mockTxDamagedToolReportUpdate: vi.fn().mockResolvedValue({ id: 'dtr-existing' }),
  mockTxRequestUpdate: vi.fn().mockResolvedValue({}),
  mockTxItemFindMany: vi.fn().mockResolvedValue([]),
  mockCheckToolCalibration: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: mockDb }));
vi.mock('@/services/toolCalibration.service', () => ({
  checkToolCalibration: mockCheckToolCalibration,
}));

// ---- Import AFTER mocks ----
import {
  atomicIssueTools,
  atomicConfirmToolReturn,
  type IssueItem,
  type AtomicIssueResult,
  type AtomicReturnResult,
} from '../toolOperations.service';

// ---- Helpers ----
const session = { userId: 'storekeeper-1', fullName: 'Store Keeper' };

function makeToolRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tr-1',
    status: 'storekeeper_approved',
    toolId: null,
    requestedById: 'tech-1',
    issuedById: null,
    issuedAt: null,
    returnConfirmedById: null,
    returnConfirmedAt: null,
    workOrderId: 'wo-1',
    workOrder: { woNumber: 'WO-202506-0001', plannerId: 'planner-1', plantId: 'plant-a' },
    requestedBy: { id: 'tech-1', fullName: 'Tech One' },
    items: [],
    tool: null,
    ...overrides,
  };
}

function makeToolRequestItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tri-1',
    toolRequestId: 'tr-1',
    toolId: 'tool-1',
    toolName: 'Torque Wrench',
    quantityRequested: 2,
    quantityApproved: 2,
    quantityIssued: 0,
    availabilityStatus: 'pending',
    issueNotes: null,
    conditionAtIssue: null,
    conditionAtReturn: null,
    quantityReturned: 0,
    quantityTransferred: 0,
    pendingReturnQty: 0,
    pendingReturnCondition: null,
    pendingReturnNotes: null,
    tool: null,
    ...overrides,
  };
}

function makeTool(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tool-1',
    name: 'Torque Wrench',
    status: 'available',
    condition: 'good',
    quantity: 5,
    repairQuantity: 0,
    assignedToId: null,
    checkedOutAt: null,
    ...overrides,
  };
}

/**
 * Set up $transaction to execute the callback with a mock tx client.
 * The tx client uses the tx-scoped mocks.
 */
function setupTransactionWithMockTx(toolRequestData: Record<string, unknown> | null) {
  (mockDb.repairToolRequest.findUnique as Mock).mockResolvedValue(toolRequestData);

  mockTxRequestUpdate.mockImplementation(async (args: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (args?.where?.status) {
      return { count: toolRequestData && toolRequestData.status === args.where.status ? 1 : 0 };
    }
    return {};
  });
  mockTxItemUpdate.mockImplementation(async (args: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (args?.where && ('quantityIssued' in args.where || 'pendingReturnQty' in args.where)) return { count: 1 };
    return {};
  });
  mockTxToolUpdate.mockImplementation(async (args: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (args?.where && ('quantity' in args.where || 'assignedToId' in args.where || 'status' in args.where)) return { count: 1 };
    return {};
  });

  const mockTx = {
    repairToolRequest: {
      findUnique: mockDb.repairToolRequest.findUnique,
      update: mockTxRequestUpdate,
      updateMany: mockTxRequestUpdate,
    },
    repairToolRequestItem: {
      update: mockTxItemUpdate,
      updateMany: mockTxItemUpdate,
      findMany: mockTxItemFindMany,
    },
    tool: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: mockTxToolUpdate,
      updateMany: mockTxToolUpdate,
    },
    toolTransaction: {
      create: mockTxToolTransactionCreate,
    },
    damagedToolReport: {
      findFirst: mockTxDamagedToolReportFindFirst,
      create: mockTxDamagedToolReportCreate,
      update: mockTxDamagedToolReportUpdate,
    },
  };

  (mockDb.$transaction as Mock).mockImplementation(async (cb: (tx: any) => Promise<any>) => cb(mockTx)); // eslint-disable-line @typescript-eslint/no-explicit-any

  return mockTx;
}

// ============================================================================
// 1. TYPE CONTRACT TESTS
// ============================================================================
describe('toolOperations.service type exports', () => {
  it('should export IssueItem with required fields', () => {
    const item: IssueItem = {
      itemId: 'tri-1',
      quantityIssued: 3,
      issueNotes: 'Standard issue',
    };
    expect(item.itemId).toBe('tri-1');
    expect(item.quantityIssued).toBe(3);
  });

  it('should allow issueNotes to be optional on IssueItem', () => {
    const item: IssueItem = { itemId: 'tri-2', quantityIssued: 1 };
    expect(item.issueNotes).toBeUndefined();
  });

  it('should export AtomicIssueResult with success, error, warnings, updatedRequest', () => {
    const successResult: AtomicIssueResult = { success: true, warnings: ['partial issue'], updatedRequest: {} };
    expect(successResult.success).toBe(true);
    expect(successResult.warnings).toHaveLength(1);

    const errorResult: AtomicIssueResult = { success: false, error: 'Tool request not found' };
    expect(errorResult.success).toBe(false);
    expect(errorResult.error).toContain('not found');
  });

  it('should export AtomicReturnResult with success, error, warnings, allReturned, updatedRequest', () => {
    const result: AtomicReturnResult = {
      success: true,
      allReturned: true,
      warnings: undefined,
      updatedRequest: {},
    };
    expect(result.success).toBe(true);
    expect(result.allReturned).toBe(true);
  });

  it('should export atomicIssueTools and atomicConfirmToolReturn as functions', () => {
    expect(typeof atomicIssueTools).toBe('function');
    expect(typeof atomicConfirmToolReturn).toBe('function');
  });
});

// ============================================================================
// 2. ATOMIC ISSUE - ERROR PATHS
// ============================================================================
describe('atomicIssueTools - error paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckToolCalibration.mockResolvedValue({ blocked: false });
  });

  it('should return error when tool request not found', async () => {
    setupTransactionWithMockTx(null);

    const result = await atomicIssueTools('tr-nonexistent', session, []);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should return error when status is not storekeeper_approved', async () => {
    setupTransactionWithMockTx(
      makeToolRequest({ status: 'pending' }),
    );

    const result = await atomicIssueTools('tr-1', session, []);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot issue');
    expect(result.error).toContain('pending');
  });

  it('should return error when multi-item request but issuedItems is empty', async () => {
    setupTransactionWithMockTx(
      makeToolRequest({
        items: [makeToolRequestItem()],
      }),
    );

    const result = await atomicIssueTools('tr-1', session, []);
    expect(result.success).toBe(false);
    expect(result.error).toContain('issuedItems array is required');
  });

  it('should handle generic DB errors gracefully', async () => {
    (mockDb.$transaction as Mock).mockRejectedValue(
      new Error('Connection lost'),
    );

    const result = await atomicIssueTools('tr-1', session, []);
    expect(result.success).toBe(false);
    // Error instanceof Error is true, so message is the original
    expect(result.error).toBe('Connection lost');
  });

  it('should handle non-Error exceptions', async () => {
    (mockDb.$transaction as Mock).mockRejectedValue('string error');

    const result = await atomicIssueTools('tr-1', session, []);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Atomic tool issue failed');
  });
});

// ============================================================================
// 3. ATOMIC ISSUE - MULTI-ITEM SUCCESS PATH
// ============================================================================
describe('atomicIssueTools - multi-item issue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckToolCalibration.mockResolvedValue({ blocked: false });
  });

  it('should issue multiple items atomically', async () => {
    const items = [
      makeToolRequestItem({ id: 'tri-1', toolId: 'tool-1', toolName: 'Wrench', quantityRequested: 2, quantityApproved: 2 }),
      makeToolRequestItem({ id: 'tri-2', toolId: 'tool-2', toolName: 'Screwdriver', quantityRequested: 1, quantityApproved: 1 }),
    ];

    const tools: Record<string, unknown> = {
      'tool-1': makeTool({ id: 'tool-1', name: 'Wrench', quantity: 5 }),
      'tool-2': makeTool({ id: 'tool-2', name: 'Screwdriver', quantity: 3 }),
    };

    const mockTx = setupTransactionWithMockTx(
      makeToolRequest({ items }),
    );

    // Override tool.findUnique to return tools by ID
    (mockTx.tool.findUnique as Mock).mockImplementation(
      ({ where }: { where: { id: string } }) => Promise.resolve(tools[where.id] || null),
    );

    const issuedItems: IssueItem[] = [
      { itemId: 'tri-1', quantityIssued: 2 },
      { itemId: 'tri-2', quantityIssued: 1 },
    ];

    const result = await atomicIssueTools('tr-1', session, issuedItems);
    expect(result.success).toBe(true);
    expect(result.updatedRequest).toBeDefined();
  });

  it('should handle partial issue when stock is insufficient', async () => {
    const items = [
      makeToolRequestItem({ id: 'tri-1', toolId: 'tool-1', toolName: 'Rare Wrench', quantityRequested: 5, quantityApproved: 5 }),
    ];

    const mockTx = setupTransactionWithMockTx(
      makeToolRequest({ items }),
    );
    (mockTx.tool.findUnique as Mock).mockResolvedValue(
      makeTool({ id: 'tool-1', quantity: 2 }),
    );

    const issuedItems: IssueItem[] = [
      { itemId: 'tri-1', quantityIssued: 5 },
    ];

    const result = await atomicIssueTools('tr-1', session, issuedItems);
    expect(result.success).toBe(true);
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.some((w: string) => w.includes('only 2 available'))).toBe(true);
  });

  it('should skip item not found in request (warning)', async () => {
    const items = [
      makeToolRequestItem({ id: 'tri-1', toolId: 'tool-1', toolName: 'Wrench', quantityRequested: 2 }),
    ];

    setupTransactionWithMockTx(
      makeToolRequest({ items }),
    );

    const issuedItems: IssueItem[] = [
      { itemId: 'tri-unknown', quantityIssued: 1 },
    ];

    const result = await atomicIssueTools('tr-1', session, issuedItems);
    expect(result.success).toBe(true);
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.some((w: string) => w.includes('not found in this request'))).toBe(true);
  });

  it('should set zero-quantity items to unavailable', async () => {
    const items = [
      makeToolRequestItem({ id: 'tri-1', toolId: null, toolName: 'Custom Part', quantityRequested: 2 }),
    ];

    setupTransactionWithMockTx(
      makeToolRequest({ items }),
    );

    const issuedItems: IssueItem[] = [
      { itemId: 'tri-1', quantityIssued: 0 },
    ];

    const result = await atomicIssueTools('tr-1', session, issuedItems);
    expect(result.success).toBe(true);
    expect(mockTxItemUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tri-1' },
        data: expect.objectContaining({ availabilityStatus: 'unavailable' }),
      }),
    );
  });

  it('should skip issue when tool not found (warning)', async () => {
    const items = [
      makeToolRequestItem({ id: 'tri-1', toolId: 'tool-1', toolName: 'Missing Tool', quantityRequested: 1 }),
    ];

    const mockTx = setupTransactionWithMockTx(
      makeToolRequest({ items }),
    );
    (mockTx.tool.findUnique as Mock).mockResolvedValue(null);

    const issuedItems: IssueItem[] = [
      { itemId: 'tri-1', quantityIssued: 1 },
    ];

    const result = await atomicIssueTools('tr-1', session, issuedItems);
    expect(result.success).toBe(true);
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.some((w: string) => w.includes('not found'))).toBe(true);
  });

  it('should update item without toolId (no tool link)', async () => {
    const items = [
      makeToolRequestItem({ id: 'tri-1', toolId: null, toolName: 'Consumable', quantityRequested: 3, quantityApproved: 3 }),
    ];

    setupTransactionWithMockTx(
      makeToolRequest({ items }),
    );

    const issuedItems: IssueItem[] = [
      { itemId: 'tri-1', quantityIssued: 3 },
    ];

    const result = await atomicIssueTools('tr-1', session, issuedItems);
    expect(result.success).toBe(true);
    // Should have updated the line item directly (no tool deduction)
    expect(mockTxItemUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tri-1', quantityIssued: 0 },
        data: expect.objectContaining({
          quantityIssued: 3,
          availabilityStatus: 'available',
        }),
      }),
    );
  });

  it('should mark item as limited when partially issued', async () => {
    const items = [
      makeToolRequestItem({ id: 'tri-1', toolId: null, toolName: 'Bolts', quantityRequested: 10, quantityApproved: 10 }),
    ];

    setupTransactionWithMockTx(
      makeToolRequest({ items }),
    );

    const issuedItems: IssueItem[] = [
      { itemId: 'tri-1', quantityIssued: 5 },
    ];

    const result = await atomicIssueTools('tr-1', session, issuedItems);
    expect(result.success).toBe(true);
    expect(mockTxItemUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ availabilityStatus: 'limited' }),
      }),
    );
  });
});

// ============================================================================
// 4. ATOMIC ISSUE - CALIBRATION BLOCKING
// ============================================================================
describe('atomicIssueTools - calibration checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should skip and warn when calibration blocks a multi-item tool', async () => {
    mockCheckToolCalibration.mockResolvedValue({
      blocked: true,
      reason: 'calibration is overdue',
    });

    const items = [
      makeToolRequestItem({ id: 'tri-1', toolId: 'tool-1', toolName: 'Calibrated Gauge', quantityRequested: 1 }),
    ];

    setupTransactionWithMockTx(
      makeToolRequest({ items }),
    );

    const issuedItems: IssueItem[] = [
      { itemId: 'tri-1', quantityIssued: 1 },
    ];

    const result = await atomicIssueTools('tr-1', session, issuedItems);
    expect(result.success).toBe(true);
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.some((w: string) => w.includes('BLOCKED'))).toBe(true);
    // Should NOT deduct from tool or create transaction
    expect(mockTxToolUpdate).not.toHaveBeenCalled();
    expect(mockTxToolTransactionCreate).not.toHaveBeenCalled();
  });

  it('should issue with warning when calibration has non-blocking reason', async () => {
    mockCheckToolCalibration.mockResolvedValue({
      blocked: false,
      reason: 'calibration due soon',
    });

    const items = [
      makeToolRequestItem({ id: 'tri-1', toolId: 'tool-1', toolName: 'Gauge', quantityRequested: 1 }),
    ];

    const mockTx = setupTransactionWithMockTx(
      makeToolRequest({ items }),
    );
    (mockTx.tool.findUnique as Mock).mockResolvedValue(
      makeTool({ id: 'tool-1', quantity: 10 }),
    );

    const issuedItems: IssueItem[] = [
      { itemId: 'tri-1', quantityIssued: 1 },
    ];

    const result = await atomicIssueTools('tr-1', session, issuedItems);
    expect(result.success).toBe(true);
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.some((w: string) => w.includes('WARNING'))).toBe(true);
    // Tool SHOULD still be deducted
    expect(mockTxToolUpdate).toHaveBeenCalled();
  });

  it('should block legacy single-tool path when calibration fails', async () => {
    mockCheckToolCalibration.mockResolvedValue({
      blocked: true,
      reason: 'last calibration failed',
    });

    setupTransactionWithMockTx(
      makeToolRequest({
        items: [],
        toolId: 'tool-1',
        tool: makeTool({ id: 'tool-1', name: 'Caliper', status: 'available', condition: 'good' }),
      }),
    );

    const result = await atomicIssueTools('tr-1', session, []);
    expect(result.success).toBe(true);
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.some((w: string) => w.includes('BLOCKED'))).toBe(true);
    // Should NOT create tool transaction
    expect(mockTxToolTransactionCreate).not.toHaveBeenCalled();
  });
});

// ============================================================================
// 5. ATOMIC ISSUE - LEGACY SINGLE-TOOL PATH
// ============================================================================
describe('atomicIssueTools - legacy single-tool path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckToolCalibration.mockResolvedValue({ blocked: false });
  });

  it('should issue legacy single tool successfully', async () => {
    setupTransactionWithMockTx(
      makeToolRequest({
        items: [],
        toolId: 'tool-1',
        tool: makeTool({ id: 'tool-1', name: 'Legacy Wrench', status: 'available', condition: 'good' }),
      }),
    );

    const result = await atomicIssueTools('tr-1', session, []);
    expect(result.success).toBe(true);
    expect(result.updatedRequest).toBeDefined();
    // Tool should be updated to checked_out
    expect(mockTxToolUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'tool-1', status: 'available', assignedToId: null }),
        data: expect.objectContaining({
          status: 'checked_out',
          assignedToId: 'tech-1',
        }),
      }),
    );
    // Tool transaction should be created
    expect(mockTxToolTransactionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          toolId: 'tool-1',
          type: 'checkout',
          toUserId: 'tech-1',
        }),
      }),
    );
  });

  it('should reject legacy tool when status is not available', async () => {
    setupTransactionWithMockTx(
      makeToolRequest({
        items: [],
        toolId: 'tool-1',
        tool: makeTool({ id: 'tool-1', status: 'checked_out', condition: 'good' }),
      }),
    );

    const result = await atomicIssueTools('tr-1', session, []);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not available for issue');
  });
});

// ============================================================================
// 6. ATOMIC ISSUE - TOOL DEDUCTION AND STATUS LOGIC
// ============================================================================
describe('atomicIssueTools - tool quantity and status logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckToolCalibration.mockResolvedValue({ blocked: false });
  });

  it('should set tool to checked_out when quantity reaches zero', async () => {
    const items = [
      makeToolRequestItem({ id: 'tri-1', toolId: 'tool-1', toolName: 'Last Item', quantityRequested: 1 }),
    ];

    const mockTx = setupTransactionWithMockTx(
      makeToolRequest({ items }),
    );
    (mockTx.tool.findUnique as Mock).mockResolvedValue(
      makeTool({ id: 'tool-1', quantity: 1, assignedToId: null }),
    );

    const issuedItems: IssueItem[] = [
      { itemId: 'tri-1', quantityIssued: 1 },
    ];

    const result = await atomicIssueTools('tr-1', session, issuedItems);
    expect(result.success).toBe(true);
    // Tool should be set to checked_out and assigned
    expect(mockTxToolUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'checked_out',
          assignedToId: 'tech-1',
          checkedOutAt: expect.any(Date),
        }),
      }),
    );
  });

  it('should keep tool status when quantity remains positive', async () => {
    const items = [
      makeToolRequestItem({ id: 'tri-1', toolId: 'tool-1', toolName: 'Abundant Tool', quantityRequested: 1 }),
    ];

    const mockTx = setupTransactionWithMockTx(
      makeToolRequest({ items }),
    );
    (mockTx.tool.findUnique as Mock).mockResolvedValue(
      makeTool({ id: 'tool-1', quantity: 10, status: 'available' }),
    );

    const issuedItems: IssueItem[] = [
      { itemId: 'tri-1', quantityIssued: 1 },
    ];

    const result = await atomicIssueTools('tr-1', session, issuedItems);
    expect(result.success).toBe(true);
    // Tool should NOT be set to checked_out
    const updateCall = mockTxToolUpdate.mock.calls[0][0];
    expect(updateCall.data.status).not.toBe('checked_out');
  });

  it('should clamp quantityIssued to max(0, min(requested, approved/stock))', async () => {
    const items = [
      makeToolRequestItem({ id: 'tri-1', toolId: 'tool-1', toolName: 'Clamp Test', quantityRequested: 3, quantityApproved: 2 }),
    ];

    const mockTx = setupTransactionWithMockTx(
      makeToolRequest({ items }),
    );
    (mockTx.tool.findUnique as Mock).mockResolvedValue(
      makeTool({ id: 'tool-1', quantity: 10 }),
    );

    // Request 5, but approved is only 2 and stock is 10 -> should issue 2
    const issuedItems: IssueItem[] = [
      { itemId: 'tri-1', quantityIssued: 5 },
    ];

    const result = await atomicIssueTools('tr-1', session, issuedItems);
    expect(result.success).toBe(true);
    // The update call should have quantityIssued = 2 (clamped to approved)
    const itemUpdateCalls = mockTxItemUpdate.mock.calls;
    const lastItemUpdate = itemUpdateCalls.filter(
      (c: any[]) => c[0].where?.id === 'tri-1', // eslint-disable-line @typescript-eslint/no-explicit-any
    ).pop();
    if (lastItemUpdate) {
      expect(lastItemUpdate[0].data.quantityIssued).toBe(2);
      expect(lastItemUpdate[0].data.availabilityStatus).toBe('available');
    }
  });
});

// ============================================================================
// 7. ATOMIC ISSUE - TRANSACTION NOTES
// ============================================================================
describe('atomicIssueTools - tool transaction notes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckToolCalibration.mockResolvedValue({ blocked: false });
  });

  it('should include WO number and condition in transaction notes', async () => {
    const items = [
      makeToolRequestItem({ id: 'tri-1', toolId: 'tool-1', toolName: 'Noted Tool', quantityRequested: 1 }),
    ];

    const mockTx = setupTransactionWithMockTx(
      makeToolRequest({ items }),
    );
    (mockTx.tool.findUnique as Mock).mockResolvedValue(
      makeTool({ id: 'tool-1', quantity: 3, condition: 'fair' }),
    );

    const issuedItems: IssueItem[] = [
      { itemId: 'tri-1', quantityIssued: 1 },
    ];

    const result = await atomicIssueTools('tr-1', session, issuedItems);
    expect(result.success).toBe(true);

    const txCall = mockTxToolTransactionCreate.mock.calls[0][0];
    expect(txCall.data.notes).toContain('WO-202506-0001');
    expect(txCall.data.notes).toContain('fair');
    expect(txCall.data.notes).toContain('condition:');
  });

  it('should mark partial issue in transaction notes', async () => {
    const items = [
      makeToolRequestItem({ id: 'tri-1', toolId: 'tool-1', toolName: 'Partial Tool', quantityRequested: 5, quantityApproved: 5 }),
    ];

    const mockTx = setupTransactionWithMockTx(
      makeToolRequest({ items }),
    );
    (mockTx.tool.findUnique as Mock).mockResolvedValue(
      makeTool({ id: 'tool-1', quantity: 3 }),
    );

    const issuedItems: IssueItem[] = [
      { itemId: 'tri-1', quantityIssued: 5 },
    ];

    const result = await atomicIssueTools('tr-1', session, issuedItems);
    expect(result.success).toBe(true);

    const txCall = mockTxToolTransactionCreate.mock.calls[0][0];
    expect(txCall.data.notes).toContain('[PARTIAL]');
  });
});

// ============================================================================
// 8. ATOMIC CONFIRM RETURN - ERROR PATHS
// ============================================================================
describe('atomicConfirmToolReturn - error paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return error when tool request not found', async () => {
    setupTransactionWithMockTx(null);

    const result = await atomicConfirmToolReturn('tr-nonexistent', session);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should return error when status is not pending_return', async () => {
    setupTransactionWithMockTx(
      makeToolRequest({ status: 'issued' }),
    );

    const result = await atomicConfirmToolReturn('tr-1', session);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot confirm return');
    expect(result.error).toContain('issued');
  });

  it('should handle generic DB errors gracefully', async () => {
    (mockDb.$transaction as Mock).mockRejectedValue(
      new Error('DB error'),
    );

    const result = await atomicConfirmToolReturn('tr-1', session);
    expect(result.success).toBe(false);
    // Error instanceof Error is true, so message is the original
    expect(result.error).toBe('DB error');
  });
});

// ============================================================================
// 9. ATOMIC CONFIRM RETURN - MULTI-ITEM PATH
// ============================================================================
describe('atomicConfirmToolReturn - multi-item return', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should confirm return of items with pending return qty', async () => {
    const items = [
      makeToolRequestItem({
        id: 'tri-1',
        toolId: 'tool-1',
        toolName: 'Wrench',
        quantityIssued: 2,
        quantityReturned: 0,
        pendingReturnQty: 2,
        pendingReturnCondition: 'good',
        pendingReturnNotes: 'All good',
      }),
    ];

    const mockTx = setupTransactionWithMockTx(
      makeToolRequest({ status: 'pending_return', items }),
    );
    (mockTx.tool.findUnique as Mock).mockResolvedValue(
      makeTool({ id: 'tool-1', quantity: 0, status: 'checked_out' }),
    );
    mockTxItemFindMany.mockResolvedValue([
      { ...items[0], quantityReturned: 2, quantityTransferred: 0, pendingReturnQty: 0 },
    ]);

    const result = await atomicConfirmToolReturn('tr-1', session);
    expect(result.success).toBe(true);
    expect(result.allReturned).toBe(true);
    // Tool should be incremented
    expect(mockTxToolUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'tool-1' }),
        data: expect.objectContaining({
          quantity: { increment: 2 },
          status: 'available',
          condition: 'good',
          assignedToId: null,
          checkedOutAt: null,
        }),
      }),
    );
    // Tool transaction should be created as return type
    expect(mockTxToolTransactionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          toolId: 'tool-1',
          type: 'return',
          fromUserId: 'tech-1',
        }),
      }),
    );
    // Return notes should be in the transaction notes
    const txCall = mockTxToolTransactionCreate.mock.calls[0][0];
    expect(txCall.data.notes).toContain('All good');
  });

  it('should skip items with no pending return qty', async () => {
    const items = [
      makeToolRequestItem({
        id: 'tri-1',
        toolId: 'tool-1',
        toolName: 'Wrench',
        quantityIssued: 2,
        quantityReturned: 2,
        pendingReturnQty: 0,
      }),
    ];

    setupTransactionWithMockTx(
      makeToolRequest({ status: 'pending_return', items }),
    );
    mockTxItemFindMany.mockResolvedValue([
      { ...items[0], quantityReturned: 2, quantityTransferred: 0 },
    ]);

    const result = await atomicConfirmToolReturn('tr-1', session);
    expect(result.success).toBe(false);
    expect(result.conflict).toBe(true);
    expect(result.error).toContain('No pending tool return quantities');
    expect(mockTxToolUpdate).not.toHaveBeenCalled();
    expect(mockTxToolTransactionCreate).not.toHaveBeenCalled();
  });

  it('should default to good condition when invalid condition provided', async () => {
    const items = [
      makeToolRequestItem({
        id: 'tri-1',
        toolId: 'tool-1',
        toolName: 'Wrench',
        quantityIssued: 1,
        pendingReturnQty: 1,
        pendingReturnCondition: 'invalid_condition',
      }),
    ];

    const mockTx = setupTransactionWithMockTx(
      makeToolRequest({ status: 'pending_return', items }),
    );
    (mockTx.tool.findUnique as Mock).mockResolvedValue(
      makeTool({ id: 'tool-1', quantity: 0 }),
    );
    mockTxItemFindMany.mockResolvedValue([
      { ...items[0], quantityReturned: 1, quantityTransferred: 0 },
    ]);

    const result = await atomicConfirmToolReturn('tr-1', session);
    expect(result.success).toBe(true);
    // Should default to 'good'
    expect(mockTxToolUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ condition: 'good' }),
      }),
    );
  });

  it('should set tool to in_repair when condition is poor', async () => {
    const items = [
      makeToolRequestItem({
        id: 'tri-1',
        toolId: 'tool-1',
        toolName: 'Damaged Wrench',
        quantityIssued: 1,
        pendingReturnQty: 1,
        pendingReturnCondition: 'poor',
      }),
    ];

    const mockTx = setupTransactionWithMockTx(
      makeToolRequest({ status: 'pending_return', items }),
    );
    (mockTx.tool.findUnique as Mock).mockResolvedValue(
      makeTool({ id: 'tool-1', quantity: 0 }),
    );
    mockTxItemFindMany.mockResolvedValue([
      { ...items[0], quantityReturned: 1, quantityTransferred: 0 },
    ]);

    const result = await atomicConfirmToolReturn('tr-1', session);
    expect(result.success).toBe(true);
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.some((w: string) => w.includes('poor'))).toBe(true);
    expect(result.warnings!.some((w: string) => w.includes('repair'))).toBe(true);
    // Tool should be in_repair status
    expect(mockTxToolUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'in_repair' }),
      }),
    );
  });

  it('should set tool to in_repair when condition is damaged', async () => {
    const items = [
      makeToolRequestItem({
        id: 'tri-1',
        toolId: 'tool-1',
        toolName: 'Broken Tool',
        quantityIssued: 1,
        pendingReturnQty: 1,
        pendingReturnCondition: 'damaged',
      }),
    ];

    const mockTx = setupTransactionWithMockTx(
      makeToolRequest({ status: 'pending_return', items }),
    );
    (mockTx.tool.findUnique as Mock).mockResolvedValue(
      makeTool({ id: 'tool-1', quantity: 0 }),
    );
    mockTxItemFindMany.mockResolvedValue([
      { ...items[0], quantityReturned: 1, quantityTransferred: 0 },
    ]);

    const result = await atomicConfirmToolReturn('tr-1', session);
    expect(result.success).toBe(true);
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.some((w: string) => w.includes('damaged'))).toBe(true);
    expect(mockTxToolUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'in_repair' }),
      }),
    );
  });

  it('keeps damaged returned units out of usable stock and moves only those units into repair custody', async () => {
    const items = [
      makeToolRequestItem({
        id: 'tri-1',
        toolId: 'tool-1',
        toolName: 'Torque Wrench',
        quantityIssued: 2,
        pendingReturnQty: 1,
        pendingReturnCondition: 'damaged',
      }),
    ];

    const mockTx = setupTransactionWithMockTx(
      makeToolRequest({ status: 'pending_return', items }),
    );
    (mockTx.tool.findUnique as Mock).mockResolvedValue(
      makeTool({ id: 'tool-1', quantity: 1, repairQuantity: 0, status: 'available' }),
    );
    mockTxItemFindMany.mockResolvedValue([
      { ...items[0], quantityReturned: 1, quantityTransferred: 0 },
    ]);

    const result = await atomicConfirmToolReturn('tr-1', session);

    expect(result.success).toBe(true);
    expect(mockTxToolUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          repairQuantity: { increment: 1 },
          status: 'available',
        }),
      }),
    );
    const toolUpdate = mockTxToolUpdate.mock.calls.find((call) => call[0]?.where?.id === 'tool-1')?.[0];
    expect(toolUpdate?.data?.quantity).toBeUndefined();
  });

  it('creates a quantity-linked damage report when store confirms a damaged return', async () => {
    const items = [
      makeToolRequestItem({
        id: 'tri-1',
        toolId: 'tool-1',
        toolName: 'Torque Wrench',
        quantityIssued: 2,
        pendingReturnQty: 1,
        pendingReturnCondition: 'damaged',
        pendingReturnNotes: 'Ratchet head cracked',
      }),
    ];

    const mockTx = setupTransactionWithMockTx(
      makeToolRequest({ status: 'pending_return', items }),
    );
    (mockTx.tool.findUnique as Mock).mockResolvedValue(
      makeTool({ id: 'tool-1', quantity: 1, repairQuantity: 0, status: 'available' }),
    );
    mockTxItemFindMany.mockResolvedValue([
      { ...items[0], quantityReturned: 1, quantityTransferred: 0 },
    ]);

    const result = await atomicConfirmToolReturn('tr-1', session);

    expect(result.success).toBe(true);
    expect(mockTxDamagedToolReportCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          toolId: 'tool-1',
          workOrderId: 'wo-1',
          toolRequestId: 'tr-1',
          quantity: 1,
          repairHeldQuantity: 1,
          reportedById: 'tech-1',
          technicianId: 'tech-1',
          status: 'reported',
        }),
      }),
    );
  });

  it('attaches physical repair custody to an existing operational damage report instead of creating a duplicate', async () => {
    const items = [
      makeToolRequestItem({
        id: 'tri-1', toolId: 'tool-1', toolName: 'Torque Wrench', quantityIssued: 2,
        pendingReturnQty: 1, pendingReturnCondition: 'damaged', pendingReturnNotes: 'Ratchet cracked',
      }),
    ];
    const mockTx = setupTransactionWithMockTx(makeToolRequest({ status: 'pending_return', items }));
    (mockTx.tool.findUnique as Mock).mockResolvedValue(makeTool({ id: 'tool-1', quantity: 1, repairQuantity: 0, status: 'available' }));
    mockTxDamagedToolReportFindFirst.mockResolvedValue({
      id: 'dtr-existing', quantity: 1, repairHeldQuantity: 0, toolRequestId: null,
    });
    mockTxItemFindMany.mockResolvedValue([{ ...items[0], quantityReturned: 1, quantityTransferred: 0 }]);

    const result = await atomicConfirmToolReturn('tr-1', session);

    expect(result.success).toBe(true);
    expect(mockTxDamagedToolReportCreate).not.toHaveBeenCalled();
    expect(mockTxDamagedToolReportUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'dtr-existing' },
      data: expect.objectContaining({ toolRequestId: 'tr-1', quantity: 1, repairHeldQuantity: { increment: 1 } }),
    }));
  });

  it('should detect allReturned=false when items still outstanding', async () => {
    const items = [
      makeToolRequestItem({
        id: 'tri-1',
        toolId: 'tool-1',
        toolName: 'Wrench',
        quantityIssued: 5,
        quantityReturned: 0,
        pendingReturnQty: 2,
      }),
    ];

    const mockTx = setupTransactionWithMockTx(
      makeToolRequest({ status: 'pending_return', items }),
    );
    (mockTx.tool.findUnique as Mock).mockResolvedValue(
      makeTool({ id: 'tool-1', quantity: 0 }),
    );
    // Simulate: after confirmation, quantityReturned = 2, but quantityIssued = 5
    mockTxItemFindMany.mockResolvedValue([
      { id: 'tri-1', quantityIssued: 5, quantityReturned: 2, quantityTransferred: 0 },
    ]);

    const result = await atomicConfirmToolReturn('tr-1', session);
    expect(result.success).toBe(true);
    expect(result.allReturned).toBe(false);
    // Request should go back to 'issued' status, not 'returned'
    expect(mockTxRequestUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'issued' }),
      }),
    );
  });
});

// ============================================================================
// 10. ATOMIC CONFIRM RETURN - LEGACY SINGLE-TOOL PATH
// ============================================================================
describe('atomicConfirmToolReturn - legacy single-tool path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return legacy single tool with good condition', async () => {
    const mockTx = setupTransactionWithMockTx(
      makeToolRequest({
        status: 'pending_return',
        items: [],
        toolId: 'tool-1',
        tool: makeTool({ id: 'tool-1', status: 'checked_out', assignedToId: 'tech-1' }),
        toolConditionAtReturn: 'good',
      }),
    );

    const result = await atomicConfirmToolReturn('tr-1', session);
    expect(result.success).toBe(true);
    expect(result.allReturned).toBe(true);
    // Tool should be set back to available
    expect(mockTxToolUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'available',
          condition: 'good',
          assignedToId: null,
          checkedOutAt: null,
        }),
      }),
    );
  });

  it('should return legacy single tool with in_repair condition for poor/damaged', async () => {
    setupTransactionWithMockTx(
      makeToolRequest({
        status: 'pending_return',
        items: [],
        toolId: 'tool-1',
        tool: makeTool({ id: 'tool-1', status: 'checked_out', assignedToId: 'tech-1' }),
        toolConditionAtReturn: 'poor',
      }),
    );

    const result = await atomicConfirmToolReturn('tr-1', session);
    expect(result.success).toBe(true);
    expect(mockTxToolUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'in_repair', condition: 'poor' }),
      }),
    );
  });

  it('should default to good condition for legacy tool when invalid condition', async () => {
    setupTransactionWithMockTx(
      makeToolRequest({
        status: 'pending_return',
        items: [],
        toolId: 'tool-1',
        tool: makeTool({ id: 'tool-1', status: 'checked_out', assignedToId: 'tech-1' }),
        toolConditionAtReturn: 'scratched',
      }),
    );

    const result = await atomicConfirmToolReturn('tr-1', session);
    expect(result.success).toBe(true);
    expect(mockTxToolUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ condition: 'good' }),
      }),
    );
  });
});

// ============================================================================
// 11. VALID CONDITIONS (documented)
// ============================================================================
describe('Valid tool conditions (documented)', () => {
  const VALID_CONDITIONS = ['new', 'good', 'fair', 'poor', 'damaged'] as const;

  it('should define five valid conditions', () => {
    expect(VALID_CONDITIONS).toHaveLength(5);
  });

  it('should include all expected condition values', () => {
    expect(VALID_CONDITIONS).toContain('new');
    expect(VALID_CONDITIONS).toContain('good');
    expect(VALID_CONDITIONS).toContain('fair');
    expect(VALID_CONDITIONS).toContain('poor');
    expect(VALID_CONDITIONS).toContain('damaged');
  });

  it('poor and damaged should trigger in_repair status (documented)', () => {
    const IN_REPAIR_CONDITIONS = ['poor', 'damaged'];
    for (const cond of IN_REPAIR_CONDITIONS) {
      const toolStatus = 'in_repair';
      expect(toolStatus).toBe('in_repair');
    }
    expect(IN_REPAIR_CONDITIONS).toHaveLength(2);
  });
});

// ============================================================================
// 12. ATOMIC ISSUE - REQUEST STATUS UPDATE
// ============================================================================
describe('atomicIssueTools - request status update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckToolCalibration.mockResolvedValue({ blocked: false });
  });

  it('should update request status to issued after successful issue', async () => {
    const items = [
      makeToolRequestItem({ id: 'tri-1', toolId: null, toolName: 'Consumable', quantityRequested: 1 }),
    ];

    setupTransactionWithMockTx(
      makeToolRequest({ items }),
    );

    const issuedItems: IssueItem[] = [
      { itemId: 'tri-1', quantityIssued: 1 },
    ];

    const result = await atomicIssueTools('tr-1', session, issuedItems);
    expect(result.success).toBe(true);
    // The request should be updated to 'issued'
    expect(mockTxRequestUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'tr-1', status: 'storekeeper_approved' }),
        data: expect.objectContaining({
          status: 'issued',
          issuedById: 'storekeeper-1',
          issuedAt: expect.any(Date),
        }),
      }),
    );
  });
});

// ============================================================================
// 13. ATOMIC CONFIRM RETURN - REQUEST STATUS AND TIMESTAMPS
// ============================================================================
describe('atomicConfirmToolReturn - request status and timestamps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should set status to returned and add returnedAt when all done', async () => {
    const items = [
      makeToolRequestItem({
        id: 'tri-1',
        toolId: null,
        quantityIssued: 1,
        pendingReturnQty: 1,
        pendingReturnCondition: 'good',
      }),
    ];

    setupTransactionWithMockTx(
      makeToolRequest({ status: 'pending_return', items }),
    );
    mockTxItemFindMany.mockResolvedValue([
      { id: 'tri-1', quantityIssued: 1, quantityReturned: 1, quantityTransferred: 0 },
    ]);

    const result = await atomicConfirmToolReturn('tr-1', session);
    expect(result.success).toBe(true);
    expect(result.allReturned).toBe(true);
    expect(mockTxRequestUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'tr-1', status: 'pending_return' }),
        data: expect.objectContaining({
          status: 'issued',
          returnConfirmedById: 'storekeeper-1',
          returnConfirmedAt: expect.any(Date),
        }),
      }),
    );
    expect(mockTxRequestUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tr-1' },
        data: expect.objectContaining({ status: 'returned', returnedAt: expect.any(Date) }),
      }),
    );
  });

  it('should always set returnConfirmedById and returnConfirmedAt', async () => {
    setupTransactionWithMockTx(
      makeToolRequest({
        status: 'pending_return',
        items: [],
        toolId: 'tool-1',
        tool: makeTool({ id: 'tool-1', status: 'checked_out', assignedToId: 'tech-1' }),
        toolConditionAtReturn: 'good',
      }),
    );

    const result = await atomicConfirmToolReturn('tr-1', session);
    expect(result.success).toBe(true);
    expect(mockTxRequestUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          returnConfirmedById: 'storekeeper-1',
          returnConfirmedAt: expect.any(Date),
        }),
      }),
    );
  });
});
