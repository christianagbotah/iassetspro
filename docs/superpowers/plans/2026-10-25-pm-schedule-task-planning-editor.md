# PM Schedule Task-Level Planning Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the PM Schedule form's single header-level recurrence/copy-task authoring with a task-level planning model and editor where each Task Master has its own TBM/UBM/CBM configuration, equipment state, duration, lead setting, and due summary.

**Architecture:** Add an additive `PmScheduleTask` association owned by `PmSchedule` and `PmTask`; new task-level schedule writes persist an exact ordered task set transactionally, while existing legacy schedules keep their current header recurrence untouched. The redesigned editor uses Task Masters, the existing asset/component hierarchy, and new draft-safe planning-source discovery. Until the later task-level generation engine slices are live, legacy automation explicitly ignores any schedule that owns `PmScheduleTask` rows so mixed task-level recurrence can never accidentally fall through the old one-cadence generator.

**Tech Stack:** Next.js App Router, React/TypeScript, Prisma 7.8/PostgreSQL, Vitest 4.1, existing `@dnd-kit` sortable UI, existing PM Task Library/template services, current asset meter/component counter/condition/IoT models.

**Spec:** `docs/superpowers/specs/2026-10-22-pm-task-level-scheduling-design.md`

## Global Constraints

- The PM Schedule header order is: PM Schedule Title, Asset / Machine, Target, Tasks and per-task Planning & Recurrence, then remaining administrative defaults.
- The new PM Schedule UI has no Schedule Description field; existing stored descriptions remain legacy compatibility data and are not destructively cleared on edit.
- Every Scheduled Task references a stable Task Master; Task Number never changes because of schedule ordering.
- Schedule `sortOrder` is independent from Task Number.
- Maintenance Mode is `TBM | UBM | CBM`.
- Equipment State is `RUNNING | STOPPED`.
- Estimated duration is stored canonically in minutes and must be non-negative.
- Lead Days must be a non-negative whole number.
- TBM supports calendar-safe `day | week | month | year` recurrence with a positive whole-number interval and an authoritative Next Due Date.
- UBM uses a real asset meter or component runtime counter, a positive interval, source-derived unit, and authoritative Next Due Reading.
- CBM uses a real component condition source or asset IoT source, comparison operator, compatible threshold/range and source unit; evaluation cadence is optional and is not maintenance recurrence.
- New active task-level schedules require at least one active Scheduled Task and complete valid planning for every active task.
- Inactive schedules may preserve incomplete planning fields as drafts, but must still contain at least one Task Master association.
- Existing legacy schedules with no `PmScheduleTask` rows continue using existing header-level frequency/trigger behavior without destructive rewrite.
- Existing PM engines must exclude schedules that have any `PmScheduleTask` row until their task-level engine slice is implemented; this plan must not create incorrect work orders from a mixed-cadence schedule.
- Existing canonical Repairs/RWOP lifecycle, historical work-order task snapshots and template history remain untouched.

## Review Focus

- **Legacy-vs-task-level generator collision:** a newly task-planned schedule must never be picked up by current schedule-level calendar/meter/signal generators.
- **Cross-plant/source injection:** Task Master, asset, target, meter, counter, condition and IoT source IDs/keys must be revalidated server-side against the selected schedule asset/plant.
- **Draft-to-active transition:** an inactive schedule may contain incomplete per-task planning, but activation must fail with field-specific task errors until every active task is complete.
- **Reorder identity safety:** reordering Scheduled Tasks may change only `sortOrder`; it must not mutate Task Master Task Number, recurrence state or source identity.
- **Migration ambiguity:** legacy schedules without deterministically linked Task Masters or with unsupported/ambiguous trigger state must remain legacy rather than receiving guessed task-level configuration.

---

### Task 1: Add Scheduled Task schema and safe deterministic backfill

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_pm_schedule_tasks/migration.sql`
- Create: `src/__tests__/pm/pm-schedule-task-planning-schema-contract.test.ts`

**Interfaces:**
- Consumes: `PmSchedule`, `PmTask`, `PmTemplateTask.pmTaskId`, existing schedule header frequency fields, `PmTrigger` compatibility data.
- Produces: `PmScheduleTask` relation plus indexes consumed by Task 2/3 and later task-level due engines.

- [ ] **Step 1: Write the failing schema/migration contract**

Assert a new `PmScheduleTask` has: `id`, `scheduleId`, `pmTaskId`, `sortOrder`, nullable `maintenanceMode`, nullable `equipmentState`, `estimatedMinutes`, `leadDays`, nullable `frequencyInterval`, nullable `frequencyUnit`, nullable `nextDueDate`, UBM source/baseline fields, CBM source/operator/threshold/unit/evaluation fields, completion/generation timestamps, `isActive`, timestamps; a required `PmTask` relation; a cascading `PmSchedule` relation; unique `[scheduleId, pmTaskId]`; and indexes for schedule/order, active mode/due scans and source lookups.

Migration assertions:
- only schedules whose active template rows already resolve to Task Masters are backfilled;
- task order copies template `sortOrder` and does not mutate Task Number;
- legacy calendar schedules create TBM rows with copied interval/unit/next due/lead days;
- canonical asset-meter schedules create UBM rows with copied meter name/unit/interval, but no guessed completion baseline when the existing trigger state is ambiguous;
- migrated rows default Equipment State to `STOPPED` as the fail-safe legacy assumption;
- template task `estimatedMinutes` is used when known, otherwise `0` rather than inventing a duration split;
- schedules without deterministically linked tasks, unsupported trigger semantics, or ambiguous ownership remain legacy with zero `PmScheduleTask` rows.

- [ ] **Step 2: Run RED**

Run: `bunx vitest run src/__tests__/pm/pm-schedule-task-planning-schema-contract.test.ts`
Expected: FAIL because `PmScheduleTask` and the migration do not exist.

- [ ] **Step 3: Implement additive schema and migration**

Use strings for mode/state/source discriminators to match current Prisma conventions. Store UBM asset-meter identity as `meterName + meterUnit`; component-counter identity as `runtimeCounterId`. Store CBM source as `conditionSourceType`, `conditionSourceId`, optional `conditionParameterKey`, `conditionOperator`, `conditionThresholdValue`, optional `conditionThresholdUpper`, `conditionUnit`, optional `evaluationInterval/evaluationUnit`.

- [ ] **Step 4: Validate**

Run: `CI=true bunx prisma validate && CI=true bunx prisma generate && bunx vitest run src/__tests__/pm/pm-schedule-task-planning-schema-contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/__tests__/pm/pm-schedule-task-planning-schema-contract.test.ts
git commit -m "feat(pm): add task-level schedule planning model"
```

### Task 2: Add canonical Scheduled Task validation and transactional persistence service

**Files:**
- Create: `src/lib/pm-schedule-task.ts`
- Create: `src/services/pm/pmScheduleTask.service.ts`
- Create: `src/lib/__tests__/pm-schedule-task.test.ts`
- Create: `src/services/pm/__tests__/pmScheduleTask.service.test.ts`

**Interfaces:**
- Consumes: Task 1 schema, `PmTask` plant ownership, asset/component/meter/counter/condition/IoT source models.
- Produces:
  - `PmScheduleTaskDraftInput`
  - `PmScheduleTaskFieldError`
  - `validatePmScheduleTaskDraft(input, context): Result`
  - `replacePmScheduleTasksInTransaction(tx, input): Promise<PmScheduleTask[]>`
  - `resolvePmScheduleTaskSourceContext(tx, input): Promise<...>`

- [ ] **Step 1: Write failing domain tests**

Cover canonical normalization and field errors for:
- Task Master required and same plant as schedule asset;
- no duplicate Task Master in one schedule;
- `RUNNING | STOPPED` only;
- non-negative whole-minute duration and non-negative whole-number lead days;
- TBM positive whole interval, unit `day|week|month|year`, valid Next Due Date;
- UBM positive numeric interval, valid same-asset meter or target-component counter, source-derived unit, new-task `nextDueReading = currentSourceValue + interval` when not supplied;
- CBM valid source, operator `>|>=|<|<=|outside_range`, threshold type/unit compatibility and two bounds for `outside_range`;
- one schedule can validate/persist a mixed ordered set such as TBM every 2 days, TBM every 30 days, UBM every 1,000 hours and CBM on a vibration threshold without one task overwriting another task's recurrence state;
- incomplete drafts allowed only when parent schedule is inactive;
- activation validation returns task-index/id-specific field errors.

- [ ] **Step 2: Run RED**

Run: `bunx vitest run src/lib/__tests__/pm-schedule-task.test.ts src/services/pm/__tests__/pmScheduleTask.service.test.ts`
Expected: FAIL because the domain/service do not exist.

- [ ] **Step 3: Implement the validator and source revalidation**

The server, not the browser, resolves current source values/units. For new UBM rows the service may derive the first Next Due Reading from the latest validated source reading plus interval. Editing an existing UBM row preserves its existing next-due baseline unless the caller explicitly changes source or requests a baseline reset through the service input.

- [ ] **Step 4: Implement exact-set transactional replacement**

`replacePmScheduleTasksInTransaction` takes the full desired ordered set, locks the schedule lifecycle/order, validates all rows before mutations, upserts existing association IDs that belong to the schedule, creates new rows, soft-deactivates removed rows where history/future engines may reference them, updates `sortOrder` only for ordering, and writes one atomic audit event containing before/after planning summaries.

- [ ] **Step 5: Verify**

Run: `bunx vitest run src/lib/__tests__/pm-schedule-task.test.ts src/services/pm/__tests__/pmScheduleTask.service.test.ts && bunx tsc -p tsconfig.repairs.json --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/pm-schedule-task.ts src/lib/__tests__/pm-schedule-task.test.ts src/services/pm/pmScheduleTask.service.ts src/services/pm/__tests__/pmScheduleTask.service.test.ts
git commit -m "feat(pm): validate and persist scheduled task planning"
```

### Task 3: Make PM Schedule CRUD task-level and preserve legacy schedules safely

**Files:**
- Modify: `src/app/api/pm-schedules/route.ts`
- Modify: `src/app/api/pm-schedules/[id]/route.ts`
- Modify: `src/services/pm/templateLifecycle.service.ts`
- Modify: `src/app/api/pm-schedules/check-due/route.ts`
- Modify: `src/services/pm/meterTriggerEngine.ts`
- Modify: `src/services/pm/conditionProductionTriggerEngine.ts`
- Create: `src/__tests__/pm/pm-schedule-task-level-api-contract.test.ts`
- Create: `src/__tests__/pm/pm-task-level-legacy-generator-isolation-contract.test.ts`

**Interfaces:**
- Consumes: Task 2 `PmScheduleTaskDraftInput` and replacement service.
- Produces schedule API shape with `scheduledTasks` and explicit `planningModel: 'task_level' | 'legacy'` projection (derived from relation presence, not a duplicate DB flag).

- [ ] **Step 1: Write failing API/security/compatibility tests**

Assert:
- new task-level POST requires Title, Asset and at least one `scheduledTasks` row; request `description` is ignored/not required;
- server validates Asset → Target ownership before scheduled-task source validation;
- task-level POST/PUT writes the header and exact task set in one transaction;
- Task Master IDs from another plant are rejected;
- schedule detail returns task rows ordered by `sortOrder` with Task Number/description/discipline from current Task Master;
- PUT without `scheduledTasks` preserves a legacy schedule's existing header recurrence behavior;
- once a schedule owns any Scheduled Task row, new UI writes do not mutate header recurrence fields;
- current calendar/meter/condition/production generators query only legacy schedules with no Scheduled Task rows;
- task-level schedules are not auto-generated by legacy engines even if their legacy header columns still contain compatibility values.

- [ ] **Step 2: Run RED**

Run: `bunx vitest run src/__tests__/pm/pm-schedule-task-level-api-contract.test.ts src/__tests__/pm/pm-task-level-legacy-generator-isolation-contract.test.ts`
Expected: FAIL on current header-recurrence APIs/generators.

- [ ] **Step 3: Implement task-level create/update/read projection**

For new task-level schedules, keep legacy non-null DB recurrence columns populated only with inert compatibility defaults required by the existing schema; they are not exposed as authoritative data and are never used by legacy generators because relation-presence isolation is mandatory. Persist `autoGenerateWO=false` for newly task-planned schedules in this slice; later engine slices explicitly enable automation after task-level due generation exists.

- [ ] **Step 4: Preserve legacy edit compatibility**

Existing schedules with zero Scheduled Task rows keep the old frequency/trigger update path until a planner converts them by submitting a valid `scheduledTasks` set. Conversion is atomic; after conversion, legacy trigger rows may remain stored for rollback/history but must be inactive so they cannot fire.

- [ ] **Step 5: Isolate existing generators**

Add relation-presence guards to calendar due generation, meter trigger discovery and condition/production trigger discovery. Do not refactor their generation logic in this slice.

- [ ] **Step 6: Verify**

Run: `bunx vitest run src/__tests__/pm/pm-schedule-task-level-api-contract.test.ts src/__tests__/pm/pm-task-level-legacy-generator-isolation-contract.test.ts src/__tests__/pm/pm-due-generation-reliability-contract.test.ts src/__tests__/pm/pm-meter-generation-reliability-contract.test.ts src/__tests__/pm/pm-signal-trigger-runtime-contract.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/pm-schedules src/services/pm/templateLifecycle.service.ts src/services/pm/meterTriggerEngine.ts src/services/pm/conditionProductionTriggerEngine.ts src/__tests__/pm
git commit -m "refactor(pm): make schedule planning task-level"
```

### Task 4: Add draft-safe UBM/CBM planning source discovery

**Files:**
- Create: `src/app/api/pm-schedules/planning-sources/route.ts`
- Create: `src/services/pm/pmSchedulePlanningSources.service.ts`
- Create: `src/services/pm/__tests__/pmSchedulePlanningSources.service.test.ts`
- Create: `src/__tests__/pm/pm-schedule-planning-sources-api-contract.test.ts`

**Interfaces:**
- Consumes: selected `assetId`, optional target `componentId`, caller plant scope.
- Produces `PmPlanningSource = { value; label; sourceType; sourceId; parameterKey?; currentValue; unit }` for draft schedules that do not yet have a schedule ID.

- [ ] **Step 1: Write failing source-discovery tests**

Cover:
- UBM whole-asset source discovery returns latest distinct asset meters;
- UBM targeted-component discovery additionally returns runtime counters (`operating_hours`, `runtime_minutes`, `cycles`, `starts`) from that exact component;
- CBM targeted-component discovery returns latest distinct `ComponentConditionReading.parameterKey` values;
- CBM whole-asset discovery returns active IoT devices belonging to the selected asset/plant;
- cross-plant asset/target/source injection is rejected;
- component must belong to selected asset;
- returned unit/current value come from server data and cannot be supplied by the client.

- [ ] **Step 2: Run RED**

Run: `bunx vitest run src/services/pm/__tests__/pmSchedulePlanningSources.service.test.ts src/__tests__/pm/pm-schedule-planning-sources-api-contract.test.ts`
Expected: FAIL because draft-safe source discovery does not exist.

- [ ] **Step 3: Implement service/API**

Reuse current meter/counter/condition/IoT models and plant-scope helpers. Do not require an existing schedule ID, unlike `/api/pm-triggers/sources`.

- [ ] **Step 4: Verify**

Run: `bunx vitest run src/services/pm/__tests__/pmSchedulePlanningSources.service.test.ts src/__tests__/pm/pm-schedule-planning-sources-api-contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/pm-schedules/planning-sources src/services/pm/pmSchedulePlanningSources.service.ts src/services/pm/__tests__/pmSchedulePlanningSources.service.test.ts src/__tests__/pm/pm-schedule-planning-sources-api-contract.test.ts
git commit -m "feat(pm): discover task planning sources"
```

### Task 5: Build the task-level PM Schedule editor

**Files:**
- Create: `src/components/modules/pm/PmScheduleEditorDialog.tsx`
- Create: `src/components/modules/pm/PmScheduleTaskPickerDialog.tsx`
- Create: `src/components/modules/pm/PmScheduledTaskPlanningCard.tsx`
- Create: `src/components/modules/pm/PmScheduledTaskPlanningList.tsx`
- Modify: `src/components/modules/MaintenancePages.tsx`
- Modify: `src/components/modules/pm/PmTaskFormDialog.tsx` only if a small callback compatibility adjustment is needed
- Modify: `src/components/modules/pm/PmTaskBulkDialog.tsx` only if a small callback compatibility adjustment is needed
- Create: `src/__tests__/pm/pm-schedule-task-level-ui-contract.test.ts`

**Interfaces:**
- Consumes: Task Library GET, Template detail resolved tasks, Task 3 schedule API, Task 4 planning-source API.
- Produces responsive schedule editor payload `{ title, assetId, componentId, scheduledTasks, priority, assignedToId, departmentId, woTypeId, isActive }`.

- [ ] **Step 1: Write failing UI contracts**

Assert the editor:
- shows fields in order: **PM Schedule Title → Asset / Machine → Target → Task Planning → administrative defaults**;
- contains no Schedule Description input;
- uses current Asset/Target explorer, allows no lower target to mean **Whole Asset**, and resets target/source selections when asset changes;
- supports **Select Existing Tasks**, **Add New Task**, **Add Multiple Tasks**, and **Load from PM Template**;
- stores Task Master identity/Task Number read-only and never edits description/action copies inside the schedule;
- renders one expandable planning card per task with sequence, Task #, description, discipline, Maintenance Mode, Equipment State, Estimated Duration, Lead Days, recurrence summary, next-due summary and remove/reorder controls;
- after Task Planning, keeps the schedule administrative defaults: Priority, Department, Assigned To, Work Order Type, and Active state;
- TBM card shows interval/unit/Next Due Date only;
- UBM card shows source/current value/unit/interval/Next Due Reading only;
- CBM card shows source/operator/threshold or range/unit plus optional evaluation cadence only;
- mode switching clears incompatible draft fields before save;
- reorder submits association/task row IDs and `sortOrder`, never Task Number;
- inactive draft can save incomplete planning with visible warnings; activation shows field-specific errors;
- task-level Auto-generate Work Order control is disabled in this slice with concise copy that task-level automation will activate in the engine rollout, rather than silently using legacy cadence.

- [ ] **Step 2: Run RED**

Run: `bunx vitest run src/__tests__/pm/pm-schedule-task-level-ui-contract.test.ts`
Expected: FAIL on the current copied-task/header-frequency form.

- [ ] **Step 3: Implement reusable task picker/list/card components**

Use Task Library records already returned by the template slice. Template starter loads Task Masters/order only; it does not invent recurrence. New task rows begin with no Maintenance Mode/Equipment State selection so the planner makes the scheduling decision explicitly.

- [ ] **Step 4: Extract and integrate `PmScheduleEditorDialog`**

Remove schedule-form state/markup from the oversized `MaintenancePages.tsx` where practical without restructuring unrelated pages. Keep list/view orchestration in `PmSchedulesPage`; the editor owns its draft state, source loads and validation display.

- [ ] **Step 5: Verify UI + TypeScript**

Run: `bunx vitest run src/__tests__/pm/pm-schedule-task-level-ui-contract.test.ts src/__tests__/pm/pm-schedule-target-ui-contract.test.ts src/__tests__/pm/pm-task-library-ui-contract.test.ts && bunx tsc -p tsconfig.repairs.json --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/modules/pm src/components/modules/MaintenancePages.tsx src/__tests__/pm
git commit -m "feat(pm): redesign schedule editor for task planning"
```

### Task 6: Make schedule list/detail task-aware and clearly distinguish legacy planning

**Files:**
- Modify: `src/components/modules/MaintenancePages.tsx`
- Create: `src/services/pm/pmSchedulePresentation.service.ts`
- Create: `src/services/pm/__tests__/pmSchedulePresentation.service.test.ts`
- Create: `src/__tests__/pm/pm-schedule-task-level-presentation-contract.test.ts`

**Interfaces:**
- Consumes: task-level schedule detail projection from Task 3.
- Produces task-level list/detail summaries while preserving legacy labels.

- [ ] **Step 1: Write failing presentation tests**

Cover:
- task-level Frequency column becomes a concise mix summary such as `3 tasks · 2 TBM · 1 UBM`, not the obsolete header frequency;
- task-level Next Due shows earliest active TBM due date when available and otherwise `Usage / condition driven` rather than a fake date;
- legacy rows retain existing frequency/next-due display and show a small `Legacy recurrence` badge;
- detail view lists every Scheduled Task with Task Number, description, discipline, mode, Equipment State, duration, lead and authoritative due summary;
- stored legacy Description is not rendered as a required/current schedule field in the redesigned detail UI.

- [ ] **Step 2: Run RED**

Run: `bunx vitest run src/services/pm/__tests__/pmSchedulePresentation.service.test.ts src/__tests__/pm/pm-schedule-task-level-presentation-contract.test.ts`
Expected: FAIL because schedule presentation is header-frequency based.

- [ ] **Step 3: Implement pure presentation resolver and UI projection**

Keep all due summaries explicit about authority: TBM date, UBM reading threshold, CBM condition; do not convert UBM/CBM into fake calendar dates.

- [ ] **Step 4: Verify**

Run: `bunx vitest run src/services/pm/__tests__/pmSchedulePresentation.service.test.ts src/__tests__/pm/pm-schedule-task-level-presentation-contract.test.ts src/__tests__/pm/pm-schedule-task-level-ui-contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/modules/MaintenancePages.tsx src/services/pm/pmSchedulePresentation.service.ts src/services/pm/__tests__/pmSchedulePresentation.service.test.ts src/__tests__/pm/pm-schedule-task-level-presentation-contract.test.ts
git commit -m "feat(pm): present task-level schedule planning"
```

### Task 7: Migration fixture and release gates

**Files:**
- Modify only if verification exposes a concrete defect in files owned by Tasks 1–6.
- Create test fixture/scripts only when needed for isolated migration verification.

**Interfaces:**
- Consumes: complete slice.
- Produces release evidence and a safe base for the following TBM/UBM/CBM engine slices.

- [ ] **Step 1: Run focused task-level schedule suite**

Run:
```bash
bunx vitest run \
  src/lib/__tests__/pm-schedule-task.test.ts \
  src/services/pm/__tests__/pmScheduleTask.service.test.ts \
  src/services/pm/__tests__/pmSchedulePlanningSources.service.test.ts \
  src/services/pm/__tests__/pmSchedulePresentation.service.test.ts \
  src/__tests__/pm/pm-schedule-task-planning-schema-contract.test.ts \
  src/__tests__/pm/pm-schedule-task-level-api-contract.test.ts \
  src/__tests__/pm/pm-task-level-legacy-generator-isolation-contract.test.ts \
  src/__tests__/pm/pm-schedule-planning-sources-api-contract.test.ts \
  src/__tests__/pm/pm-schedule-task-level-ui-contract.test.ts \
  src/__tests__/pm/pm-schedule-task-level-presentation-contract.test.ts
```
Expected: PASS.

- [ ] **Step 2: Run all PM compatibility tests**

Run: `bunx vitest run src/__tests__/pm src/services/pm/__tests__ src/lib/__tests__/pm-schedule-task.test.ts`
Expected: PASS; legacy PM automation contracts remain green with explicit task-level isolation.

- [ ] **Step 3: Run schema/lint/lifecycle/TypeScript gates**

Run:
```bash
CI=true bunx prisma validate
CI=true bunx prisma generate
bunx eslint src/app/api/pm-schedules src/services/pm src/components/modules/pm src/components/modules/MaintenancePages.tsx src/__tests__/pm
bunx tsx scripts/check-rwop-legacy-lifecycle-imports.ts
bunx tsc -p tsconfig.repairs.json --noEmit
git diff --check
```
Expected: PASS.

- [ ] **Step 4: Verify migration against isolated PostgreSQL fixtures**

Use a clean migrated DB plus a production-shaped fixture containing:
- a legacy calendar schedule with two master-linked template tasks;
- a canonical asset-meter schedule;
- a schedule whose template tasks are still legacy/null-linked;
- a condition/production trigger schedule that cannot be safely inferred;
- a schedule with historical PM work orders/task executions.

Assert deterministic schedules gain ordered `PmScheduleTask` rows, Task Numbers/history remain unchanged, fail-safe `STOPPED` is used only for migrated legacy rows, ambiguous schedules remain legacy, and no current trigger/work-order history is deleted.

- [ ] **Step 5: Run full repository regression and production build**

Run:
```bash
bunx vitest run
bun run build
git diff --check
```
Expected: PASS.

- [ ] **Step 6: Final review and PR**

Normal PR CI remains authoritative. Do not merge until the exact PR head has green Lint, Unit Tests, Repairs TypeScript gate, Build, Production Container Build, Repairs UAT, E2E and Required CI Gate. After deployment, verify `RELEASE_SHA`, PM2 online and public HTTP 200 before starting the task-level TBM generation slice.
