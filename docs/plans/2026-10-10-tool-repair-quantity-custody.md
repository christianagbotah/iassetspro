# Tool Repair Quantity Custody Hardening

## Goal
Keep damaged/poor returned tool units out of usable Tool.quantity until repair is complete and store/QC accepts them, without marking an entire multi-quantity Tool SKU unavailable when serviceable stock remains.

## Constraints
- Tool.quantity remains usable/issuable stock.
- Add repair-held quantity instead of redesigning Tool into serialized units in this PR.
- Damaged/poor multi-tool returns move returned units into repair custody, not usable quantity.
- Repair completion alone must not restore usable stock; store/QC acceptance does.
- Serviceable returns retain current behavior.
- Legacy single serialized-tool behavior remains compatible.
- Direct Tool edit API must not allow quantity/status/condition/assignee custody mutation around canonical workflows.

## Tasks
1. Test-first: prove damaged multi-quantity return does not increment usable stock and increments repair-held quantity; mixed remaining stock stays available.
2. Add schema/migration for Tool.repairQuantity and DamagedToolReport.quantity/QC metadata needed for repair-held release.
3. Make damaged-tool lifecycle operations quantity-aware and atomic so report creation, repair completion, QC acceptance/write-off move custody with their tool transactions.
4. Wire existing damaged-tools API/UI to quantity-aware lifecycle and add QC accept action.
5. Block direct Tool edit custody-field bypasses and add contract tests.
6. Add Repairs UAT proving: 3 usable → issue 2 → return 1 damaged => usable 1, repair 1; repair complete still usable 1; QC accept => usable 2, repair 0.
7. Run focused unit/contract/TypeScript/lint/UAT discovery gates, review diff, push PR only after green.
