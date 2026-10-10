ALTER TABLE "tools" ADD COLUMN "repairQuantity" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "damaged_tool_reports" ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "damaged_tool_reports" ADD COLUMN "repairHeldQuantity" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "damaged_tool_reports" ADD COLUMN "qcAcceptedById" TEXT;
ALTER TABLE "damaged_tool_reports" ADD COLUMN "qcAcceptedAt" TIMESTAMP(3);
ALTER TABLE "damaged_tool_reports" ADD COLUMN "qcNotes" TEXT;
