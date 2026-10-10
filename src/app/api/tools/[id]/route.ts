import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession, hasPermission, isAdmin } from '@/lib/auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = getSession(request);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const { id } = await params;

    const tool = await db.tool.findUnique({
      where: { id },
      include: {
        assignedTo: { select: { id: true, fullName: true, username: true } },
        createdBy: { select: { id: true, fullName: true, username: true } },
        transactions: {
          include: {
            performedBy: { select: { id: true, fullName: true, username: true } },
            fromUser: { select: { id: true, fullName: true, username: true } },
            toUser: { select: { id: true, fullName: true, username: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!tool) {
      return NextResponse.json(
        { success: false, error: 'Tool not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: tool });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to load tool';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = getSession(request);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }
    if (!hasPermission(session, 'tools.update') && !isAdmin(session)) {
      return NextResponse.json({ success: false, error: 'Insufficient permissions' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    const existing = await db.tool.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Tool not found' },
        { status: 404 }
      );
    }

    const custodyFields = ['quantity', 'repairQuantity', 'status', 'condition', 'assignedToId', 'expectedReturn', 'isActive'];
    const attemptedCustodyFields = custodyFields.filter((field) => body[field] !== undefined);
    if (attemptedCustodyFields.length > 0) {
      return NextResponse.json({
        success: false,
        error: `Tool custody fields (${attemptedCustodyFields.join(', ')}) cannot be changed through generic edit; use the issue, return, repair/QC, transfer, or retirement workflow`,
      }, { status: 400 });
    }

    // Generic edit is metadata-only. Custody mutations are workflow-controlled above.
    const updateData: Record<string, unknown> = {};
    const allowedFields = [
      'name', 'description', 'category', 'serialNumber',
      'location', 'purchaseDate', 'purchaseCost', 'currentValue', 'manufacturer',
      'model',
    ];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        if (field === 'purchaseDate') {
          updateData[field] = body[field] ? new Date(body[field]) : null;
        } else {
          updateData[field] = body[field];
        }
      }
    }

    const updated = await db.tool.update({
      where: { id },
      data: updateData,
      include: {
        assignedTo: { select: { id: true, fullName: true, username: true } },
        createdBy: { select: { id: true, fullName: true, username: true } },
      },
    });

    // Create audit log
    await db.auditLog.create({
      data: {
        userId: session.userId,
        action: 'update',
        entityType: 'tool',
        entityId: id,
        oldValues: JSON.stringify({ toolCode: existing.toolCode, status: existing.status }),
        newValues: JSON.stringify(updateData),
      },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update tool';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = getSession(request);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    if (!hasPermission(session, 'tools.delete') && !isAdmin(session)) {
      return NextResponse.json({ success: false, error: 'Insufficient permissions' }, { status: 403 });
    }

    const { id } = await params;

    const existing = await db.tool.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Tool not found' },
        { status: 404 }
      );
    }

    // Soft delete
    const deactivated = await db.tool.update({
      where: { id },
      data: { isActive: false, assignedToId: null, status: 'retired' },
    });

    // Create audit log
    await db.auditLog.create({
      data: {
        userId: session.userId,
        action: 'delete',
        entityType: 'tool',
        entityId: id,
        oldValues: JSON.stringify({ toolCode: existing.toolCode, isActive: existing.isActive }),
        newValues: JSON.stringify({ isActive: false }),
      },
    });

    return NextResponse.json({ success: true, data: deactivated });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to deactivate tool';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
