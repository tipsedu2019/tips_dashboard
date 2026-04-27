# tips_dashboard v2 management v1 parity implementation plan

> For Hermes: implement this in phases. Preserve v1 behavior for students/classes/textbooks and master-data CRUD, but keep the v2 visual shell polished and minimal.

Goal: Rebuild v2 학생관리 / 수업관리 / 교재관리 to match v1 behavior, plus 학교/선생님/강의실/학기 마스터 and related CRUD flows, while keeping the quieter shadcn/ui-based v2 look.

Architecture:
- Keep the v2 route structure (`/admin/students`, `/admin/classes`, `/admin/textbooks`) and shared management shell.
- Replace the current read-only management stack with a shared management workspace that separates data access, actions, dialogs/sheets, and record normalization.
- Port proven v1 behavior in layers: data service parity -> shared toolbar/selection/actions -> editors/master managers -> import/export/bulk update -> route/nav integration.

Tech stack:
- Next.js app router
- React client components
- shadcn/ui (dialog, sheet, drawer, popover, table, tabs, command, checkbox, input, select, badge, button)
- Supabase client
- Existing v2 management record normalizers and v1 data-manager logic as reference

---

## Audited source-of-truth references

v1 reference files:
- `src/components/DataManager.jsx`
- `src/components/data-manager/StudentManagerTab.jsx`
- `src/components/data-manager/ClassManagerTab.jsx`
- `src/components/data-manager/TextbookManagerTab.jsx`
- `src/components/data-manager/ClassEditor.jsx`
- `src/components/data-manager/DataManagerEditors.jsx`
- `src/components/data-manager/SchoolCatalogManagerModal.jsx`
- `src/components/data-manager/ResourceCatalogManagerModal.jsx`
- `src/components/data-manager/BulkUpdateModal.jsx`
- `src/components/ui/TermManagerModal.jsx`
- `src/hooks/useManagerActions.js`
- `src/hooks/useDataTableControls.js`
- `src/services/dataService.js`

Current v2 files:
- `v2/src/features/management/management-page.tsx`
- `v2/src/features/management/management-data-table.tsx`
- `v2/src/features/management/use-management-records.ts`
- `v2/src/features/management/records.js`
- `v2/src/app/admin/students/page.tsx`
- `v2/src/app/admin/classes/page.tsx`
- `v2/src/app/admin/textbooks/page.tsx`
- `v2/src/lib/navigation.ts`

---

## Phase 1: shared management action/data layer

### Task 1: add v2 management service facade
Objective: create a v2-friendly service layer exposing the same CRUD/master operations v1 already uses.

Files:
- Create: `v2/src/features/management/management-service.ts`
- Test: `tests/v2-management-service-contract.test.js`

Requirements:
- Expose methods for:
  - students: add/update/delete/bulk delete/bulk upsert
  - classes: add/update/delete/bulk delete/bulk update/bulk upsert
  - textbooks: add/update/delete/bulk delete/bulk update
  - school master: upsert/delete
  - teacher master: upsert/delete
  - classroom master: upsert/delete
  - class terms: fetch/upsert/delete
  - app preference: get/set
- Use Supabase directly in v2, but keep signatures close to v1 behaviors.
- Reuse v1 payload rules where practical:
  - class status normalization
  - classroom normalization
  - id generation
  - optimistic-friendly return shapes

Verification:
- Add contract-style tests for payload shape helpers and return normalization.

### Task 2: extract shared v2 management action hook
Objective: move read-only management into a richer action model.

Files:
- Create: `v2/src/features/management/use-management-actions.ts`
- Modify: `v2/src/features/management/management-page.tsx`
- Test: `tests/v2-management-actions-contract.test.js`

Requirements:
- Owns:
  - create/edit/delete state
  - bulk update state
  - master-manager state
  - import/export busy state
  - refresh trigger wiring
- Page should compose:
  - records hook
  - action hook
  - data table
  - dialogs/sheets

---

## Phase 2: shared workspace shell parity

### Task 3: upgrade management page API from read-only to interactive workspace
Objective: let the page pass commands and state to the shared table.

Files:
- Modify: `v2/src/features/management/management-page.tsx`
- Test: `tests/v2-management-shell-polish.test.js`

Requirements:
- Table receives handlers for:
  - create new
  - edit selected row
  - delete row(s)
  - open masters
  - open term manager
  - upload/download/export
  - bulk update
- Keep screen minimal: filters + table first, no summary card reintroduction.

### Task 4: add per-kind toolbar actions mirroring v1 behavior
Objective: give each page the same operational affordances as v1.

Files:
- Modify: `v2/src/features/management/management-data-table.tsx`
- Possibly create: `v2/src/features/management/management-toolbar.tsx`
- Test: `tests/v2-management-shell-polish.test.js`

Requirements:
- Students toolbar:
  - 학생 등록
  - 템플릿 다운로드
  - 데이터 업로드
  - 학교 마스터
- Classes toolbar:
  - 수업 등록
  - 학기 quick filter
  - 과목 segmented filter
  - 학년 / 선생님 / 강의실 quick filters
  - 템플릿 다운로드
  - 데이터 업로드
  - 선생님 마스터
  - 강의실 마스터
  - 학기 마스터
- Textbooks toolbar:
  - 교재 등록
  - 템플릿 다운로드
  - 데이터 업로드
- Keep the current settings popover for column controls.

### Task 5: add selection action strip parity
Objective: restore useful row-selection operations from v1.

Files:
- Modify: `v2/src/features/management/management-data-table.tsx`
- Test: `tests/v2-management-shell-polish.test.js`

Requirements:
- Show selected row count
- Allow select-all visible rows
- Bulk delete for all kinds
- Bulk update for classes/textbooks only
- Keep row/column density v2-polished, not card-like

---

## Phase 3: editors and detail flows

### Task 6: implement student editor in v2
Objective: restore full student CRUD and enrollment editing.

Files:
- Create: `v2/src/features/management/editors/student-editor.tsx`
- Create: `v2/src/features/management/utils/student-form.ts`
- Test: `tests/v2-student-editor-contract.test.js`

Requirements:
- Fields:
  - name
  - grade
  - school
  - contact
  - parentContact
  - uid
  - enrollDate
- Enrollment management:
  - search classes
  - add/remove enrolled classes
  - add/remove waitlist classes
  - move between enrolled/waitlist
- Validation: name required
- Preserve school/grade compatibility behavior from v1

### Task 7: implement class editor in v2
Objective: restore v1 class editing behavior but keep the v2 dedicated work-sheet look.

Files:
- Create: `v2/src/features/management/editors/class-editor.tsx`
- Create: `v2/src/features/management/utils/class-form.ts`
- Test: `tests/v2-class-editor-contract.test.js`

Requirements:
- Fields:
  - className
  - subject
  - grade
  - status
  - teacher
  - classroom
  - schedule
  - capacity
  - fee
  - startDate
  - endDate
  - termId / period
- Restore:
  - teacher/classroom filtering by selected subject
  - conflict detection for teacher/classroom schedule collisions
  - textbook multi-select/order
  - enrolled/waitlist student management
  - schedule-plan linkage where still relevant
- Validation: className, subject, teacher required

### Task 8: implement textbook editor in v2
Objective: restore full textbook CRUD and lesson/tag editing.

Files:
- Create: `v2/src/features/management/editors/textbook-editor.tsx`
- Create: `v2/src/features/management/editors/textbook-quick-editor.tsx`
- Test: `tests/v2-textbook-editor-contract.test.js`

Requirements:
- Fields:
  - title
  - publisher
  - price
  - tags
  - lessons
- Behaviors:
  - add/remove tags
  - add/remove lessons
  - frequent tags persistence
- Validation: title required

### Task 9: add class manifest dialog
Objective: restore v1 registered-student manifest from class list.

Files:
- Create: `v2/src/features/management/dialogs/student-manifest-dialog.tsx`
- Modify: `v2/src/features/management/management-data-table.tsx`
- Test: `tests/v2-class-manifest-dialog.test.js`

Requirements:
- Shows registered students for selected class
- Includes quick jump to class editor
- Maintains dense operational styling

---

## Phase 4: master-data managers

### Task 10: implement school master manager
Objective: restore v1 학교 마스터 CRUD.

Files:
- Create: `v2/src/features/management/masters/school-master-sheet.tsx`
- Create: `v2/src/features/management/utils/school-master.ts`
- Test: `tests/v2-school-master-sheet.test.js`

Requirements:
- Tabs by school category
- Add/reorder/delete schools within category
- Validation: required name, no duplicate normalized names
- Save with category-specific sort order

### Task 11: implement teacher/classroom master manager
Objective: restore shared resource master behavior from v1.

Files:
- Create: `v2/src/features/management/masters/resource-master-sheet.tsx`
- Create: `v2/src/features/management/utils/resource-master.ts`
- Test: `tests/v2-resource-master-sheet.test.js`

Requirements:
- Reusable for teachers and classrooms
- Subject tabs
- Subject association chips
- visible/hidden toggle
- reorder/delete/add
- empty subject set means global/common

### Task 12: implement term manager in v2
Objective: restore 학기 마스터 and class-term workflow.

Files:
- Create: `v2/src/features/management/masters/term-manager-sheet.tsx`
- Create: `v2/src/features/management/utils/term-manager.ts`
- Test: `tests/v2-term-manager-sheet.test.js`

Requirements:
- Load/save/delete class terms
- current-term designation support if still represented
- sorted by academic year desc + sort order
- classes page toolbar can open it directly

---

## Phase 5: import/export and bulk update parity

### Task 13: port bulk update flows
Objective: restore classes/textbooks bulk update.

Files:
- Create: `v2/src/features/management/dialogs/bulk-update-dialog.tsx`
- Modify: `v2/src/features/management/use-management-actions.ts`
- Test: `tests/v2-management-bulk-update.test.js`

Requirements:
- Classes bulk fields:
  - teacher, grade, status, classroom, subject, period
- Textbooks bulk fields:
  - publisher, tags(addTags)
- Clear selection after success

### Task 14: port template/sample download helpers
Objective: support v1-equivalent sample downloads.

Files:
- Create: `v2/src/features/management/import-export/download-templates.ts`
- Test: `tests/v2-management-import-export-contract.test.js`

Requirements:
- Filenames:
  - `TIPS-학생업로드-샘플.xlsx`
  - `TIPS-수업업로드-샘플.xlsx`
  - `TIPS-교재업로드-샘플.xlsx`
- Also export current list equivalents where implemented

### Task 15: port spreadsheet upload flows
Objective: restore v1 upload behavior with merge semantics.

Files:
- Create: `v2/src/features/management/import-export/upload-parsers.ts`
- Create: `v2/src/features/management/import-export/upload-actions.ts`
- Modify: `v2/src/features/management/use-management-actions.ts`
- Test: `tests/v2-management-upload-contract.test.js`

Requirements:
- Students upload:
  - uid/name matching
  - class/waitlist merge semantics
- Classes upload:
  - class match key semantics from v1
  - optional student creation/update
  - textbook title resolution
  - blank schedule count handling
- Textbooks upload:
  - title matching
  - tags/lessons parsing

---

## Phase 6: navigation and route polish

### Task 16: extend v2 nav metadata for master flows if exposed via routes
Objective: make master flows discoverable if they become dedicated routes instead of only sheets.

Files:
- Modify: `v2/src/lib/navigation.ts`
- Test: `tests/v2-management-navigation.test.js`

Requirements:
- If masters remain sheets only, keep existing nav clean.
- If master routes are introduced, group them under 관리/설정 without clutter.

---

## Verification checklist

Focused tests:
- `scripts/run_tests.sh tests/v2-management-shell-polish.test.js`
- `scripts/run_tests.sh tests/v2-management-records.test.js`
- `scripts/run_tests.sh tests/v2-management-column-schema.test.js`
- plus each new v2 management test file added in this plan

Route/build verification:
- `cd /home/hyunjun/hermes/workspace/tips_dashboard/v2 && npm run build`
- Verify routes:
  - `/admin/students`
  - `/admin/classes`
  - `/admin/textbooks`

Manual functional verification after implementation:
- 학생 등록/수정/삭제
- 학교 마스터 저장
- 수업 등록/수정/삭제
- 선생님/강의실 마스터 저장
- 학기 마스터 저장
- 수업 명단(manifest) 열기
- 교재 등록/수정/삭제
- 수업/교재 bulk update
- 샘플 다운로드 + 업로드 roundtrip

---

## Important constraints

- Behavioral source of truth is v1, not current v2.
- Visual source of truth is v2 minimal polished workspace, not v1 card styling.
- Do not add dashboard-like summary cards back to these work screens.
- Keep shared implementations centralized; avoid forking separate students/classes/textbooks pages unless behavior truly diverges.
- When changing recommended default columns or toolbar structure, remember existing localStorage state can mask the new defaults.
