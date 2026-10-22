# PM Task Library Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first production-safe slice of the approved PM redesign: a plant-scoped Task Master library with single creation/editing, transactional multi-row bulk creation, and validated Excel template import.

**Architecture:** Add a new `PmTask` master entity without changing current `PmTemplateTask`, `PmSchedule`, PM recurrence, or automation behavior. Centralize task normalization, validation, monotonic per-plant numbering, transactional creation, and audit in a PM task service so single, bulk, and Excel-confirm paths cannot diverge; expose focused APIs and a dedicated Task Library page that uses existing plant headers and RBAC.

**Tech Stack:** Next.js App Router, React/TypeScript, Prisma 7.8/PostgreSQL, Vitest 4.1, SheetJS `xlsx` 0.18.5, existing shadcn-style UI components, existing `apiFetch`, `getPlantScope`, RBAC, and `AuditLog` patterns.

**Spec:** `docs/superpowers/specs/2026-10-22-pm-task-level-scheduling-design.md`

## Global Constraints

- Task Master user-facing definition is exactly Task Number, Task Description, and Task Type; system ownership/audit fields remain internal.
- Task Number is server-generated, read-only, monotonic within plant scope, never renumbered by deactivation, and independent from future template/schedule sort order.
- Initial canonical Task Types are `mechanical`, `electrical`, `plumbing`, and `lubrication`, displayed as Mechanical, Electrical, Plumbing, and Lubrication.
- Single, bulk, and Excel-confirm creation must use the same canonical validation and creation service.
- Bulk and import confirmation are all-or-nothing database transactions; no partial batch may survive a validation or database failure.
- Excel uses the already-installed `xlsx` package; documented preferred format is `.xlsx`, while `.xls` is accepted only through the same safe parser path.
- Blank spreadsheet rows are ignored; unknown task types are errors; in-file and existing-library duplicates are warnings, not automatic merges.
- Task Library writes require an explicit valid plant context; list/read operations obey existing multi-plant visibility rules.
- Current `PmTemplateTask`, `PmSchedule`, schedule-level recurrence, PM trigger, and PM work-order generation behavior must remain unchanged in this plan.
- Existing canonical Repairs/RWOP execution and analytics are untouched.

## Review Focus

- **Concurrent creators in the same plant:** numbering must remain unique and sequential under simultaneous single/bulk/import writes; Task 2 pins this with an advisory-lock/next-number test.
- **Cross-plant access or missing selected plant:** list calls may span authorized plants, but create/update/deactivate/import writes must never escape the selected authorized plant; Tasks 3 and 4 pin 403/400 behavior.
- **Malformed/oversized Excel workbooks:** bad extension, empty workbook, missing/duplicate required headers, files over 10 MB, and more than 1,000 nonblank rows must fail before any write; Task 4 pins each case.
- **Duplicate task text:** duplicate rows within an upload and case-insensitive potential duplicates already in the selected plant must surface warnings while still permitting explicit confirmation; Task 4 pins warning semantics.
- **Batch database failure:** a failure after numbering begins must roll back task rows and audit rows together, with no partial batch and no browser-supplied task number trusted; Task 2 pins transaction/audit behavior.

---

## File Structure

### New files

- `src/lib/pm-task.ts` — client/server-safe canonical task types, labels, draft types, normalization, and pure batch validation.
- `src/services/pm/pmTask.service.ts` — plant-scoped monotonic number allocation, transactional single/batch creation, update/deactivation helpers, and task/audit write orchestration.
- `src/services/pm/pmTaskImport.service.ts` — Excel template generation, workbook parsing, structural validation, duplicate warning calculation, normalized preview model.
- `src/app/api/pm-tasks/route.ts` — plant-scoped list and single create.
- `src/app/api/pm-tasks/[id]/route.ts` — direct task read/update/soft-deactivate.
- `src/app/api/pm-tasks/bulk/route.ts` — manual multi-row transactional creation.
- `src/app/api/pm-tasks/import-template/route.ts` — downloadable Excel template.
- `src/app/api/pm-tasks/import-preview/route.ts` — multipart workbook parse/validation preview; no writes.
- `src/app/api/pm-tasks/import-confirm/route.ts` — revalidate accepted normalized rows and transactionally create them with import audit metadata.
- `src/components/modules/pm/PmTaskLibraryPage.tsx` — searchable/filterable task table and page orchestration.
- `src/components/modules/pm/PmTaskFormDialog.tsx` — single create/edit form.
- `src/components/modules/pm/PmTaskBulkDialog.tsx` — spreadsheet-like manual row editor with paste support and Save All.
- `src/components/modules/pm/PmTaskImportDialog.tsx` — workbook upload, validation preview, warnings/errors, confirmation.
- `src/lib/__tests__/pm-task.test.ts` — pure task normalization and batch-validation tests.
- `src/services/pm/__tests__/pmTask.service.test.ts` — mocked-transaction numbering/atomicity tests.
- `src/services/pm/__tests__/pmTaskImport.service.test.ts` — workbook template/parser/preview tests.
- `src/__tests__/pm/pm-task-library-schema-contract.test.ts` — Prisma schema/migration/RBAC contract.
- `src/__tests__/pm/pm-task-library-api-contract.test.ts` — auth, permissions, plant scope, shared-service use, write atomicity contract.
- `src/__tests__/pm/pm-task-library-ui-contract.test.ts` — page/navigation/RBAC and creation-path UI contract.
- `prisma/migrations/20261022131500_add_pm_task_master/migration.sql` — additive PostgreSQL schema for `pm_tasks` only.

### Existing files modified

- `prisma/schema.prisma` — add `PmTask` and `User`/`Plant` relations only; no legacy PM field removal.
- `prisma/seed-permissions-only.ts` — define `pm_tasks` permissions and role grants.
- `prisma/seed.ts` — keep production seed permission catalog/bundles in sync.
- `prisma/seed-all.ts` — keep comprehensive seed permission catalog/bundles in sync.
- `prisma/seed-missing.ts` — keep additive/missing permission sync in sync.
- `src/app/api/admin/sync-permissions/route.ts` — expose matching runtime permission sync grants.
- `src/types/index.ts` — add the `pm-tasks` `PageName`; task domain types remain centralized in `src/lib/pm-task.ts`.
- `src/lib/page-access.ts` — gate `pm-tasks` with `pm_tasks.view`.
- `src/components/EAMApp.tsx` — title and lazy page registry entry.
- `src/components/shared/Sidebar.tsx` — add Task Library under PM Maintenance.
- `src/components/shared/MobileBottomNav.tsx` — include `pm-tasks` in PM active pages.
- `src/components/CommandPalette.tsx` — add Task Library navigation command.

---

### Task 1: Additive Task Master Schema and RBAC Contract

**Files:**
- Create: `src/__tests__/pm/pm-task-library-schema-contract.test.ts`
- Create: `prisma/migrations/20261022131500_add_pm_task_master/migration.sql`
- Modify: `prisma/schema.prisma`
- Modify: `prisma/seed-permissions-only.ts`
- Modify: `prisma/seed.ts`
- Modify: `prisma/seed-all.ts`
- Modify: `prisma/seed-missing.ts`
- Modify: `src/app/api/admin/sync-permissions/route.ts`

**Interfaces:**
- Produces Prisma model `PmTask` with fields `id`, `plantId`, `taskNumber`, `description`, `taskType`, `isActive`, `createdById`, `createdAt`, `updatedAt`.
- Produces unique key `@@unique([plantId, taskNumber])` and lookup index `@@index([plantId, taskType, isActive])`.
- Produces RBAC slugs `pm_tasks.view`, `pm_tasks.create`, `pm_tasks.update`, `pm_tasks.delete`, `pm_tasks.import`.
- Role grants: `plant_manager` gets `pm_tasks.view`; `maintenance_manager` and `maintenance_planner` get all five; maintenance supervisor/technician receive no new Task Library grants in this slice.

- [ ] **Step 1: Write the failing schema/RBAC contract test**

Add tests that assert the Prisma source contains `model PmTask`, plant relation, user creator relation, composite task-number uniqueness, active/type index, and that each permission catalog defines `pm_tasks` with exactly `view/create/update/delete/import`. Assert the role bundles above in `seed-permissions-only.ts` and runtime sync mirror them.

- [ ] **Step 2: Run the contract test and prove RED**

Run: `npx vitest run src/__tests__/pm/pm-task-library-schema-contract.test.ts`

Expected: FAIL because `PmTask` and `pm_tasks.*` do not exist.

- [ ] **Step 3: Add the additive Prisma model and SQL migration**

Add `PmTask` to `prisma/schema.prisma` with `plantId String`, `taskNumber Int`, `description String`, `taskType String`, `isActive Boolean @default(true)`, creator/timestamps, relation name `PmTaskCreatedBy`, and `@@map("pm_tasks")`. Add `pmTasks PmTask[]` to `Plant` and `pmTasksCreated PmTask[] @relation("PmTaskCreatedBy")` to `User`.

Create only the `pm_tasks` table, indexes, unique constraint, and plant/user foreign keys in `prisma/migrations/20261022131500_add_pm_task_master/migration.sql`. Do not alter `pm_template_tasks`, `pm_schedules`, or triggers.

- [ ] **Step 4: Add permission definitions and exact role grants**

Add `pm_tasks: ['view', 'create', 'update', 'delete', 'import']` to all permission definition sources. Mirror `pm_templates.view` visibility for plant managers with `pm_tasks.view`; grant all five task permissions to maintenance managers/planners. Keep supervisor/technician behavior unchanged.

- [ ] **Step 5: Validate Prisma and run the contract test GREEN**

Run: `npx prisma validate && npx prisma generate && npx vitest run src/__tests__/pm/pm-task-library-schema-contract.test.ts`

Expected: Prisma validation/generation succeed; test PASS.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261022131500_add_pm_task_master/migration.sql prisma/seed-permissions-only.ts prisma/seed.ts prisma/seed-all.ts prisma/seed-missing.ts src/app/api/admin/sync-permissions/route.ts src/__tests__/pm/pm-task-library-schema-contract.test.ts
git commit -m "feat(pm): add task master schema and permissions"
```

---

### Task 2: Canonical Task Validation, Numbering, and Transactional Creation Service

**Files:**
- Create: `src/lib/pm-task.ts`
- Create: `src/lib/__tests__/pm-task.test.ts`
- Create: `src/services/pm/pmTask.service.ts`
- Create: `src/services/pm/__tests__/pmTask.service.test.ts`

**Interfaces:**
- `src/lib/pm-task.ts` produces `PM_TASK_TYPES = ['mechanical', 'electrical', 'plumbing', 'lubrication'] as const`, `PmTaskType`, `PmTaskDraft`, `NormalizedPmTaskDraft`, display labels, `normalizePmTaskDraft(input: PmTaskDraft)`, and `validatePmTaskBatch(rows: PmTaskDraft[])`.
- `validatePmTaskBatch` returns `{ rows: NormalizedPmTaskDraft[]; rowErrors: Array<{ row: number; messages: string[] }> }` using 1-based user row numbers.
- `src/services/pm/pmTask.service.ts` produces `createPmTaskBatch(input: { plantId: string; userId: string; rows: PmTaskDraft[]; source: 'single' | 'bulk' | 'import'; filename?: string }): Promise<PmTask[]>`, with `PmTask` imported from `@prisma/client`.
- `createPmTaskBatch` owns `db.$transaction`, builds lock key `iassetspro:pm-task-number:${plantId}` and acquires it with parameterized `SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`, reads the current max task number for that plant after the lock, assigns contiguous numbers, writes with Prisma `createManyAndReturn`, and writes task plus batch/import audit records inside the same transaction.
- Produces `updatePmTask(input: { taskId: string; plantId: string; userId: string; patch: { description?: string; taskType?: string; isActive?: boolean } }): Promise<PmTask>` and `deactivatePmTask(input: { taskId: string; plantId: string; userId: string }): Promise<PmTask>`; both audit in the same transaction.

- [ ] **Step 1: Write RED normalization/validation tests**

In `src/lib/__tests__/pm-task.test.ts`, pin trimming, case-insensitive canonicalization (`"  ELECTRICAL " -> "electrical"`), required description, unknown type rejection, blank batch rejection, and row-numbered batch errors.

- [ ] **Step 2: Run validation tests and prove RED**

Run: `npx vitest run src/lib/__tests__/pm-task.test.ts src/services/pm/__tests__/pmTask.service.test.ts`

Expected: FAIL because the task domain/service files do not exist.

- [ ] **Step 3: Implement constants and pure validation functions**

Implement the pure constants/types/validation in `src/lib/pm-task.ts`; implement no Excel, database, route, or auth logic there.

- [ ] **Step 4: Run validation tests GREEN**

Run: `npx vitest run src/lib/__tests__/pm-task.test.ts`

Expected: validation cases PASS.

- [ ] **Step 5: Add RED transaction/numbering tests with a mocked Prisma transaction**

Assert same-plant creation acquires the transaction-scoped advisory lock before reading `_max.taskNumber`; an existing max of 17 allocates 18/19/20; browser-provided extra fields cannot supply task numbers; invalid row prevents `$transaction`; `createManyAndReturn` and audit writes occur inside one transaction; a thrown create/audit error rejects the whole service call.

- [ ] **Step 6: Implement transactional numbering/create/update/deactivate**

Use a parameterized Prisma `$executeRaw` tagged template for the plant-specific advisory lock. Build `createManyAndReturn` data only from normalized `description`, canonical `taskType`, server-assigned `taskNumber`, `plantId`, and `createdById`. Create individual `pm_task` audit rows plus one `pm_task_batch` summary for `bulk`/`import`; import summary includes filename, row count, and created IDs.

- [ ] **Step 7: Run all service tests GREEN**

Run: `npx vitest run src/services/pm/__tests__/pmTask.service.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/pm-task.ts src/lib/__tests__/pm-task.test.ts src/services/pm/pmTask.service.ts src/services/pm/__tests__/pmTask.service.test.ts
git commit -m "feat(pm): add transactional task master service"
```

---

### Task 3: Plant-Scoped CRUD and Manual Bulk APIs

**Files:**
- Create: `src/app/api/pm-tasks/route.ts`
- Create: `src/app/api/pm-tasks/[id]/route.ts`
- Create: `src/app/api/pm-tasks/bulk/route.ts`
- Create: `src/__tests__/pm/pm-task-library-api-contract.test.ts`

**Interfaces:**
- `GET /api/pm-tasks?search=&type=&active=` returns tasks filtered by `getPlantScope`/`getPlantFilterWhere`, ordered by `taskNumber` ascending, with creator and plant display metadata.
- `POST /api/pm-tasks` accepts only `{ description, taskType }`, requires `pm_tasks.create`, explicit valid selected plant, delegates to `createPmTaskBatch(...source:'single')`, and returns the created task.
- `GET /api/pm-tasks/:id` requires `pm_tasks.view` and direct-ID plant access.
- `PATCH /api/pm-tasks/:id` accepts `{ description?, taskType?, isActive? }`, requires `pm_tasks.update`, requires an explicit selected plant, verifies the task belongs to that exact selected plant, and delegates to `updatePmTask`.
- `DELETE /api/pm-tasks/:id` is a soft deactivation only, requires `pm_tasks.delete`, requires an explicit selected plant, verifies the task belongs to that exact selected plant, and delegates to `deactivatePmTask`; it never deletes a row.
- `POST /api/pm-tasks/bulk` accepts `{ rows: PmTaskDraft[] }`, requires `pm_tasks.create`, explicit valid selected plant, and delegates once to `createPmTaskBatch(...source:'bulk')`.

- [ ] **Step 1: Write failing API contract tests**

Assert every route checks authentication and exact permissions, calls `getPlantScope`, fails closed on denied plant access, list uses `getPlantFilterWhere`, writes require `plantScope.plantId`, direct-ID writes verify entity plant, DELETE is soft-deactivate, and single/bulk POST routes delegate to the shared service instead of allocating numbers locally.

- [ ] **Step 2: Run the API contract and prove RED**

Run: `npx vitest run src/__tests__/pm/pm-task-library-api-contract.test.ts`

Expected: FAIL because routes do not exist.

- [ ] **Step 3: Implement list and single-create route**

Return consistent `{ success, data }` / `{ success:false, error }` responses. Explicit unauthorized selected plant is 403; missing selected plant on writes is 400 with actionable copy such as `Select a plant before creating PM tasks`.

- [ ] **Step 4: Implement direct read/update/soft-deactivate route**

Require `plantScope.plantId` before mutation, fetch the task’s `plantId`, verify direct access with `canAccessPlantStrict`, and require `task.plantId === plantScope.plantId`. Return 404 for missing task and 403 for an inaccessible/mismatched task without leaking other plant data in response details.

- [ ] **Step 5: Implement manual bulk route**

Reject missing/non-array/empty `rows`; otherwise delegate all validation and writes to `createPmTaskBatch`. Return row validation details on 400 and no created rows when any row is invalid.

- [ ] **Step 6: Run API/service tests GREEN**

Run: `npx vitest run src/__tests__/pm/pm-task-library-api-contract.test.ts src/services/pm/__tests__/pmTask.service.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/pm-tasks src/__tests__/pm/pm-task-library-api-contract.test.ts
git commit -m "feat(pm): expose task library CRUD and bulk APIs"
```

---

### Task 4: Excel Template, Preview, Duplicate Warnings, and Transactional Confirm APIs

**Files:**
- Create: `src/services/pm/pmTaskImport.service.ts`
- Create: `src/services/pm/__tests__/pmTaskImport.service.test.ts`
- Create: `src/app/api/pm-tasks/import-template/route.ts`
- Create: `src/app/api/pm-tasks/import-preview/route.ts`
- Create: `src/app/api/pm-tasks/import-confirm/route.ts`
- Modify: `src/__tests__/pm/pm-task-library-api-contract.test.ts`

**Interfaces:**
- Constants: `PM_TASK_IMPORT_MAX_BYTES = 10 * 1024 * 1024`, `PM_TASK_IMPORT_MAX_ROWS = 1000`.
- Produces `buildPmTaskImportTemplate(): Buffer` with sheets `Tasks` and `Instructions`; `Tasks` headers are exactly `Task Description`, `Task Type` and contains no Task Number column.
- Produces `ParsedPmTaskImport = { filename: string; rows: Array<{ sourceRow: number; description: string; taskType: string }>; structuralErrors: string[] }` and `parsePmTaskWorkbook(buffer: Buffer, filename: string): ParsedPmTaskImport`, accepting `.xlsx` and `.xls` only, ignoring blank rows, enforcing exact required headers and row limit.
- Produces `PmTaskImportPreview = { filename: string; totalRows: number; validRows: number; invalidRows: number; warningCount: number; rows: Array<{ sourceRow: number; description: string; taskType: string; errors: string[]; warnings: string[] }> }` and `buildPmTaskImportPreview(input: { parsed: ParsedPmTaskImport; plantId: string }): Promise<PmTaskImportPreview>`; it uses `normalizePmTaskDraft` and adds within-file and existing-library duplicate warnings scoped to the selected plant.
- `GET /api/pm-tasks/import-template` requires `pm_tasks.import` (or admin) and returns the current template; it does not require a selected plant because it writes no plant data.
- `POST /api/pm-tasks/import-preview` requires `pm_tasks.import`, selected valid plant, multipart field `file`, max 10 MB, then returns preview only—never writes.
- `POST /api/pm-tasks/import-confirm` requires both `pm_tasks.import` and `pm_tasks.create`, selected valid plant, accepts `{ filename, rows }`, reruns canonical row validation and duplicate-warning calculation, blocks structural/validation errors, then delegates once to `createPmTaskBatch(...source:'import', filename)`.

- [ ] **Step 1: Write failing template/parser tests**

Assert workbook contains both sheets, exact Tasks headers, Instructions mentions all four allowed types and server numbering, `.xlsx`/`.xls` parsing, blank-row ignore, case normalization, missing header error, unknown type row error, >1,000 row rejection, and wrong extension rejection.

- [ ] **Step 2: Run import service tests and prove RED**

Run: `npx vitest run src/services/pm/__tests__/pmTaskImport.service.test.ts`

Expected: FAIL because import service does not exist.

- [ ] **Step 3: Implement template generation and parser**

Use only SheetJS `xlsx`; read the first `Tasks` sheet by name, not arbitrary first sheet. Treat repeated/missing required headers as structural errors. Do not execute formulas or rely on workbook macros.

- [ ] **Step 4: Add failing duplicate-preview tests**

Pin duplicate warnings for repeated normalized `(description, taskType)` rows in one upload and potential existing tasks matched case-insensitively by normalized description in the same plant. Assert warnings do not become `rowErrors`.

- [ ] **Step 5: Implement duplicate preview calculation**

Keep warnings informational; do not merge or silently discard rows. Existing-task warning query must include selected `plantId` and must not search across plants.

- [ ] **Step 6: Write failing import API contract cases**

Assert preview has no write call, preview/confirm enforce explicit plant scope, preview requires `pm_tasks.import`, confirm requires import+create, file-size guard is 10 MB, confirm calls `createPmTaskBatch` and never accepts a task number from the request.

- [ ] **Step 7: Implement template/preview/confirm routes**

Template route returns an XLSX attachment named `pm-task-import-template.xlsx`. Preview returns row numbers, normalized display values, errors/warnings, and counts. Confirm revalidates server-side and writes transactionally through the shared service.

- [ ] **Step 8: Run import and API tests GREEN**

Run: `npx vitest run src/services/pm/__tests__/pmTaskImport.service.test.ts src/__tests__/pm/pm-task-library-api-contract.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/services/pm/pmTaskImport.service.ts src/services/pm/__tests__/pmTaskImport.service.test.ts src/app/api/pm-tasks/import-template src/app/api/pm-tasks/import-preview src/app/api/pm-tasks/import-confirm src/__tests__/pm/pm-task-library-api-contract.test.ts
git commit -m "feat(pm): add validated task Excel import"
```

---

### Task 5: Task Library Page, Navigation, Single Create/Edit, and Soft Deactivation

**Files:**
- Create: `src/components/modules/pm/PmTaskLibraryPage.tsx`
- Create: `src/components/modules/pm/PmTaskFormDialog.tsx`
- Create: `src/__tests__/pm/pm-task-library-ui-contract.test.ts`
- Modify: `src/types/index.ts`
- Modify: `src/lib/page-access.ts`
- Modify: `src/components/EAMApp.tsx`
- Modify: `src/components/shared/Sidebar.tsx`
- Modify: `src/components/shared/MobileBottomNav.tsx`
- Modify: `src/components/CommandPalette.tsx`

**Interfaces:**
- `PageName` gains `'pm-tasks'`.
- The page defines its API record view from the canonical `PmTaskType` exported by `src/lib/pm-task.ts`; no second task-type union is introduced. API records contain `id`, `plantId`, `taskNumber`, `description`, `taskType`, `isActive`, timestamps, optional plant/creator display data.
- `PmTaskLibraryPage` uses `apiFetch('/pm-tasks?...')`; existing `apiFetch` automatically supplies auth and selected `X-Plant-ID` from local storage.
- Page actions are gated with `pm_tasks.create`, `pm_tasks.update`, `pm_tasks.delete`, `pm_tasks.import` or admin status.
- `PmTaskFormDialog` never exposes editable Task Number; edit mode displays number read-only and edits description/type only.

- [ ] **Step 1: Write failing navigation/UI contract tests**

Assert `pm-tasks` exists in `PageName`, title map, lazy registry, `page-access`, desktop sidebar PM children, mobile PM active pages, and command palette. Assert the page has Task Number/Description/Type/Status columns and the four action labels `Add Task`, `Add Multiple Tasks`, `Download Excel Template`, `Import Excel`.

- [ ] **Step 2: Run UI contract and prove RED**

Run: `npx vitest run src/__tests__/pm/pm-task-library-ui-contract.test.ts`

Expected: FAIL because page/navigation entries do not exist.

- [ ] **Step 3: Add navigation and page registration**

Add `PM Tasks`/`Task Library` under the existing PM Maintenance group using module code `pm_schedules` so licensing remains the existing MRMP/PM module boundary. Gate direct page access with `pm_tasks.view`.

- [ ] **Step 4: Build Task Library list/filter states**

Implement responsive table/card presentation with search, task type filter, active/all filter, loading skeleton, empty state, refresh, and Task Number prominently read-only. Show Plant when results span multiple plants so duplicate per-plant task numbers are not ambiguous. Use task-number ascending order from the API; do not client-renumber filtered rows.

- [ ] **Step 5: Build single create/edit/deactivate UX**

Single form has only description and type as editable inputs. Edit shows immutable task number. Deactivate uses existing confirm-dialog pattern and DELETE endpoint; optionally reactivate through PATCH only for actors with update permission.

- [ ] **Step 6: Run UI contract GREEN and changed-file lint**

Run: `npx vitest run src/__tests__/pm/pm-task-library-ui-contract.test.ts && npx eslint src/components/modules/pm/PmTaskLibraryPage.tsx src/components/modules/pm/PmTaskFormDialog.tsx src/components/EAMApp.tsx src/components/shared/Sidebar.tsx src/components/shared/MobileBottomNav.tsx src/components/CommandPalette.tsx src/lib/page-access.ts src/types/index.ts`

Expected: PASS / exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/components/modules/pm/PmTaskLibraryPage.tsx src/components/modules/pm/PmTaskFormDialog.tsx src/__tests__/pm/pm-task-library-ui-contract.test.ts src/types/index.ts src/lib/page-access.ts src/components/EAMApp.tsx src/components/shared/Sidebar.tsx src/components/shared/MobileBottomNav.tsx src/components/CommandPalette.tsx
git commit -m "feat(pm): add task library page"
```

---

### Task 6: Multi-Row Bulk Editor and Excel Import UX

**Files:**
- Create: `src/components/modules/pm/PmTaskBulkDialog.tsx`
- Create: `src/components/modules/pm/PmTaskImportDialog.tsx`
- Modify: `src/components/modules/pm/PmTaskLibraryPage.tsx`
- Modify: `src/__tests__/pm/pm-task-library-ui-contract.test.ts`

**Interfaces:**
- `PmTaskBulkDialog` owns rows `{ clientId, description, taskType, errors[] }`, supports add/remove, spreadsheet paste into the grid, local required/type feedback, and sends one `{ rows }` request to `/pm-tasks/bulk` on Save All.
- Pasted tab/newline text maps column 1 -> Task Description and column 2 -> Task Type; extra columns are ignored with visible row validation rather than becoming task numbers.
- `PmTaskImportDialog` downloads `/pm-tasks/import-template`, uploads FormData field `file` to `/pm-tasks/import-preview`, renders total/valid/invalid/warning counts and row messages, and sends normalized `{ filename, rows }` to `/pm-tasks/import-confirm` only when structural/row errors are zero.
- Successful single/bulk/import writes close the dialog, toast the created count, and refresh the library.

- [ ] **Step 1: Extend UI contract tests to prove RED**

Assert bulk grid has add/remove row and `Save All`, posts once to `/pm-tasks/bulk`, includes paste parsing, and never includes `taskNumber` in the payload. Assert import dialog uses FormData preview, displays errors/warnings, disables confirm when invalid rows exist, downloads the template route, and confirms through `/pm-tasks/import-confirm`.

- [ ] **Step 2: Run focused UI contract and prove RED**

Run: `npx vitest run src/__tests__/pm/pm-task-library-ui-contract.test.ts`

Expected: FAIL on missing bulk/import components.

- [ ] **Step 3: Implement bulk editor**

Start with one blank row, permit adding/removing rows, parse pasted TSV/newline data, preserve user input after server validation errors, and render returned row errors beside the matching row. Save All is disabled while submitting or when no nonblank rows exist.

- [ ] **Step 4: Implement Excel import dialog**

Use an ordinary file picker accepting `.xlsx,.xls`; show filename/size before upload. Preview must be an explicit step before confirmation. Duplicate warnings remain visible but do not disable Confirm; structural/validation errors do disable it.

- [ ] **Step 5: Wire both dialogs into Task Library and run tests GREEN**

Run: `npx vitest run src/__tests__/pm/pm-task-library-ui-contract.test.ts src/services/pm/__tests__/pmTaskImport.service.test.ts src/lib/__tests__/pm-task.test.ts src/services/pm/__tests__/pmTask.service.test.ts`

Expected: PASS.

- [ ] **Step 6: Run changed-file lint**

Run: `npx eslint src/components/modules/pm/PmTaskLibraryPage.tsx src/components/modules/pm/PmTaskBulkDialog.tsx src/components/modules/pm/PmTaskImportDialog.tsx`

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/components/modules/pm/PmTaskLibraryPage.tsx src/components/modules/pm/PmTaskBulkDialog.tsx src/components/modules/pm/PmTaskImportDialog.tsx src/__tests__/pm/pm-task-library-ui-contract.test.ts
git commit -m "feat(pm): add bulk and Excel task creation UX"
```

---

### Task 7: Phase-1 Regression, Migration Safety, and Release Gate

**Files:**
- Modify only files required to fix failures uncovered by this gate; do not broaden scope into PM Template/Schedule task associations.

**Interfaces:**
- Produces a clean branch whose only product behavior change is the new Task Library foundation.
- Existing PM schedule/template/trigger tests remain green and current legacy PM write/read paths remain intact.

- [ ] **Step 1: Run all new PM Task tests together**

Run: `npx vitest run src/lib/__tests__/pm-task.test.ts src/services/pm/__tests__/pmTask.service.test.ts src/services/pm/__tests__/pmTaskImport.service.test.ts src/__tests__/pm/pm-task-library-schema-contract.test.ts src/__tests__/pm/pm-task-library-api-contract.test.ts src/__tests__/pm/pm-task-library-ui-contract.test.ts`

Expected: PASS.

- [ ] **Step 2: Run the existing PM regression suite**

Run: `npx vitest run src/__tests__/pm`

Expected: PASS; especially no regressions in schedule/template/trigger lifecycle tests.

- [ ] **Step 3: Run Prisma and TypeScript release checks**

Run: `npx prisma validate && npx prisma generate && npx tsc -p tsconfig.repairs.json --noEmit`

Expected: all exit 0.

- [ ] **Step 4: Run lint for the full changed-file set**

Run the repository ESLint command against every changed `.ts/.tsx` source file from `git diff --name-only origin/main...HEAD`.

Expected: exit 0.

- [ ] **Step 5: Run full unit suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Run production build**

Run: `npm run build`

Expected: build succeeds.

- [ ] **Step 7: Validate migration and diff hygiene**

Run: `git diff --check origin/main...HEAD && git status --short && git diff --stat origin/main...HEAD`

Expected: no whitespace errors; only approved Phase-1 files changed; no generated `.next`, local DB, uploaded workbook, or environment files tracked.

- [ ] **Step 8: Verify no legacy PM recurrence/template behavior was modified**

Run: `git diff --name-only origin/main...HEAD | grep -E 'pm-schedules|pm-templates|pm-triggers|automationRunner|meterTriggerEngine|conditionProductionTriggerEngine' || true`

Expected: no product implementation files from those legacy flows appear. Permission/navigation references are allowed only where explicitly listed in this plan.


---

## Phase Boundary / Follow-on Plans

This plan deliberately stops after the standalone Task Library foundation is production-ready. The approved architecture continues through separate plans so each subsystem remains reviewable and deployable:

1. **PM Template ↔ Task Master association migration** — convert `PmTemplateTask` into a Task Master association, backfill legacy template tasks without unsafe description deduplication, add library selection/inline task creation/reorder.
2. **PM Schedule Task model and compatibility migration** — add `PmScheduleTask`, redesign header/target/tasks editor, copy current schedule recurrence into deterministic legacy tasks, preserve legacy-only schedules.
3. **Task-level TBM engine** — independent calendar recurrence, due dates, lead days, completion advancement.
4. **Task-level UBM engine** — meter/counter source, next-due reading, usage evaluation.
5. **Task-level CBM engine** — measurement source/operator/threshold and condition evaluation.
6. **Due-task grouping and canonical Repairs/RWOP generation** — bundle compatible due tasks, snapshot instructions, advance only verified completed tasks, preserve rework semantics.
7. **PM execution-effectiveness analytics** — build from canonical Repairs facts after task-level execution is live.
