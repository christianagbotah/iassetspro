-- Historical Asset ↔ Functional Location assignments.
-- Additive only: legacy Asset location/building/floor/area fields remain untouched.

CREATE TABLE "asset_functional_location_assignments" (
  "id" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "hierarchySystemId" TEXT NOT NULL,
  "functionalLocationId" TEXT NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveTo" TIMESTAMP(3),
  "locationCodeSnapshot" TEXT NOT NULL,
  "locationPathSnapshot" TEXT NOT NULL,
  "assignedById" TEXT NOT NULL,
  "endedById" TEXT,
  "reason" TEXT,
  "endReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "asset_functional_location_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "asset_fl_assignment_time_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom")
);

CREATE INDEX "asset_fl_assignments_assetId_idx"
  ON "asset_functional_location_assignments"("assetId");
CREATE INDEX "asset_fl_assignments_hierarchySystemId_idx"
  ON "asset_functional_location_assignments"("hierarchySystemId");
CREATE INDEX "asset_fl_assignments_functionalLocationId_idx"
  ON "asset_functional_location_assignments"("functionalLocationId");
CREATE INDEX "asset_fl_assignments_effectiveFrom_idx"
  ON "asset_functional_location_assignments"("effectiveFrom");

-- One current placement per asset per hierarchy system. Historical rows remain unlimited.
CREATE UNIQUE INDEX "asset_fl_assignments_one_active_per_system_idx"
  ON "asset_functional_location_assignments"("assetId", "hierarchySystemId")
  WHERE "effectiveTo" IS NULL;

ALTER TABLE "asset_functional_location_assignments"
  ADD CONSTRAINT "asset_fl_assignments_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "asset_functional_location_assignments"
  ADD CONSTRAINT "asset_fl_assignments_hierarchySystemId_fkey"
  FOREIGN KEY ("hierarchySystemId") REFERENCES "hierarchy_systems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "asset_functional_location_assignments"
  ADD CONSTRAINT "asset_fl_assignments_functionalLocationId_fkey"
  FOREIGN KEY ("functionalLocationId") REFERENCES "functional_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "asset_functional_location_assignments"
  ADD CONSTRAINT "asset_fl_assignments_assignedById_fkey"
  FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "asset_functional_location_assignments"
  ADD CONSTRAINT "asset_fl_assignments_endedById_fkey"
  FOREIGN KEY ("endedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
