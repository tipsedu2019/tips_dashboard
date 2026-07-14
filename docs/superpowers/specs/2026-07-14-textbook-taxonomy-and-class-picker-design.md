# Textbook Taxonomy and Class Picker Design

**Date:** 2026-07-14
**Status:** Approved direction, written-spec review pending

## Goal

Make every textbook consistently classifiable by subject, school level, grade, and sub-subject, while allowing one textbook to cover multiple school levels and grades. Use that taxonomy to make the class-detail textbook picker start with relevant candidates and let operators deliberately widen the search. Apply the same relevant-first pattern to the student-detail class picker so operators see the student's grade first and can intentionally widen to every grade for exceptions.

## Existing Problems

1. `textbooks.school_level` and `textbooks.grade_level` are scalar strings, so the data model cannot represent a textbook that applies to several grades or all school levels.
2. Many existing rows have only a school level or only a grade. The table therefore displays `-` even when the missing value can be derived.
3. Subject, school level, grade, and sub-subject are not enforced as one required classification contract.
4. The class-detail textbook picker currently searches only title, subject, and publisher. It does not use the class subject or grade and offers no taxonomy filters.
5. The student-detail class picker currently shows every unlinked class. It ignores the student's school level and grade, so operators must search through unrelated classes before registering or waitlisting a student.

## Chosen Model

Add two authoritative array columns to `public.textbooks`:

- `school_levels text[]`
- `grade_levels text[]`

Allowed school-level values are `elementary`, `middle`, and `high`. Allowed grade values are `e1` through `e6`, `m1` through `m3`, and `h1` through `h3`.

The existing scalar `school_level` and `grade_level` columns remain as compatibility projections during the transition. A save writes both forms. When exactly one value is selected, the scalar stores it. When several values are selected, the scalar stores the first value in the canonical elementary-to-high and low-to-high order. New code treats the arrays as authoritative and uses scalar values only as a fallback for an older row.

The database enforces these invariants after backfill:

- `subject` is non-empty and normalized to `english`, `math`, or `other`.
- `school_levels` contains at least one allowed value.
- `grade_levels` contains at least one allowed value.
- every selected grade belongs to a selected school level.
- every selected school level has at least one selected grade.
- `sub_subject` is non-empty.

## Selection Rules

The master editor uses checkbox groups for school levels and grades.

1. Checking a school level adds every grade in that school level by default.
2. The operator may then uncheck grades to narrow the textbook.
3. Checking a grade automatically checks its school level.
4. Unchecking a school level removes all grades belonging to it.
5. Unchecking the last grade for a school level also unchecks that school level.
6. Save is blocked if subject, school level, grade, or sub-subject is empty.
7. Multiple school levels and grades may remain selected. This supports textbooks that genuinely apply to every student.

These transitions live in pure taxonomy helpers so the create form, edit form, bulk edit, filters, and tests share one rule set.

## Existing Data Backfill

The migration updates every existing textbook in one forward-only transaction. Classification priority is:

1. Preserve an existing explicit grade and derive its school level.
2. Preserve an existing explicit school level; when no grade is known, select every grade in that school level.
3. Infer a grade or school level from the current title and category using the same Korean grade tokens already recognized by the application.
4. If neither school level nor grade can be inferred, select all three school levels and all twelve grades, as explicitly approved by the operator.

Subject is normalized from the existing value and falls back to `other`. Sub-subject preserves the explicit value, then uses the cleaned legacy category, and finally falls back to `기타`. `기타` is inserted into the sub-subject settings for English and mathematics when absent so the required fallback remains editable through the normal UI.

The migration does not overwrite title, publisher, ISBN, pricing, inventory, purchase, sale, or class-link data.

## Master List and Editor UX

The textbook master table renders compact summaries:

- all three school levels: `초·중·고`
- all grades within the selected school levels: `전 학년`
- a full single school range: `초1–초6`, `중1–중3`, or `고1–고3`
- a narrowed set: the selected grade labels, such as `고1 · 고3`

The editor keeps the existing field order and visual system. Subject and sub-subject stay selects. School level and grade become compact checkbox groups with their automatic relationship visible immediately. Required markers and validation messages appear on all four taxonomy fields.

Bulk editing supports the same arrays. Choosing a school level in bulk edit starts with that school level's full grade set; the operator can narrow it before applying the patch.

## Class Textbook Picker

Opening `교재 추가` derives initial filters from the selected class:

- subject: the class subject
- school level: derived from the class grade
- grade: the class grade
- sub-subject: `전체`, unless the class has an explicit sub-subject

The candidate list initially shows textbooks matching all active filters. Array membership is inclusive: a textbook is eligible when its selected school levels and grades contain the class filter values. A textbook classified for all grades therefore appears for every matching class.

Above the result list, the picker provides four compact filters: subject, school level, grade, and sub-subject. Changing school level limits the grade options. `전체 보기` resets every filter to all values while preserving the text search. Clearing the text search is a separate action.

Each candidate row displays title plus `과목 · 학교 구분 · 학년 · 세부과목 · 출판사`. Already connected textbooks remain visible in the class detail even when they do not match the current picker filters. Adding or removing a link continues to save through the class's existing `textbook_ids` flow.

## Student Class Picker

Opening `수업 선택` in a student detail starts in a relevant-first scope derived from the student's current grade. Because a grade already determines its school level (`고2` implies `고등`), the picker does not add a duplicate school-level control.

The default scope is `같은 학년`. A 고2 student therefore sees only unlinked 고2 classes. Classes with a different grade or no grade remain available through a single `전체 학년` scope switch. This avoids guessing school affinity from a class name and does not require adding school metadata to classes.

The scope switch sits inside the existing picker, directly above the candidate list. It uses two compact options:

- `같은 학년`: the default when the student has a grade
- `전체 학년`: shows every unlinked class

When the student has no grade, the picker starts in `전체 학년`; it does not show an empty same-grade result. Text search applies within the active scope. Changing the student's grade while the detail is open immediately recalculates the same-grade candidates. Opening a different student resets the scope to the relevant default instead of preserving the previous student's widened state.

Candidate rows keep the existing class metadata order: `과목 · 학년 · 요일/시간`. Already registered and waitlisted classes remain in their existing sections and are not affected by the picker scope. `등록 추가` and `대기 추가` continue to use the current relation-save flow.

## Data Flow

1. The textbook service reads array columns and falls back to scalar columns for compatibility.
2. Taxonomy helpers normalize arrays, labels, selection transitions, and containment matching.
3. Master create, edit, and bulk-save payloads send canonical arrays and scalar projections together.
4. The management data hook includes complete taxonomy metadata in `available_textbooks` for class details.
5. The class detail initializes filter state from its current subject and grade whenever a different class opens.
6. Candidate filtering happens client-side over the already loaded catalog; no additional request is made for each filter change.
7. The student detail computes its default class scope from the current form grade and filters the already loaded class catalog client-side.
8. The student class scope resets to `같은 학년` for a graded student and `전체 학년` for an ungraded student whenever a different student opens.

## Migration and Rollout

The schema change is an expand-and-switch migration:

1. Add nullable array columns with empty-array defaults.
2. Backfill and normalize all existing rows.
3. Add allowed-value and cross-field consistency constraints.
4. Set the arrays to `not null` with empty-array defaults; application and database validation prevent saving an empty required classification.
5. Keep scalar columns for compatibility.
6. Deploy the array-aware client.

The migration is idempotent and does not edit historical migration files. Before applying it, capture aggregate counts for missing classifications. After applying it, verify total row count is unchanged, every required field is populated, every grade maps to a selected school level, and class textbook links still reference existing textbooks.

## Error Handling

- Client validation shows a Korean field-level message and prevents save when a required taxonomy field is empty.
- The service rejects invalid array combinations before sending a request.
- Database constraints provide the final integrity boundary for direct or older clients.
- A backfill verification failure aborts the migration transaction instead of leaving partially normalized data.
- The class picker shows `조건에 맞는 교재 없음` with `전체 보기` as the immediate recovery action.

## Test Strategy

### Taxonomy unit tests

- school selection adds every corresponding grade
- grade selection adds its school level
- school removal removes its grades
- last-grade removal removes its school level
- normalization prefers arrays and falls back to scalars
- all-school and all-grade labels are rendered correctly
- candidate containment accepts broad textbooks and rejects unrelated grades

### Service and migration tests

- create, edit, and bulk update write arrays and scalar projections
- rows with grade only derive school level
- rows with school level only receive every grade in that level
- unclassified rows receive all school levels and all grades
- missing sub-subject becomes `기타`
- migration preserves textbook count and class `textbook_ids`
- invalid empty or cross-school combinations are rejected

### UI and browser checks

- master create and edit forms enforce all four required fields
- checking `고등` selects `고1`, `고2`, and `고3`
- checking `초6` selects `초등`
- a broad textbook displays `초·중·고` and `전 학년`
- a 고3 mathematics class opens with mathematics, high-school, and 고3 filters
- filter changes widen and narrow candidates without hiding connected textbooks
- result metadata and long lists remain readable and scrollable in the existing modal
- a 고2 student initially sees only unlinked 고2 classes
- `전체 학년` immediately restores classes from other grades and classes without a grade
- an ungraded student starts in `전체 학년`
- changing the student grade recalculates the same-grade list without another request
- opening a different student restores that student's relevant default scope
- text search filters only the candidates inside the active grade scope

## Out of Scope

- Automatically choosing a class's textbook without operator confirmation
- Changing inventory, purchase, receipt, issue, or settlement workflows
- Removing the legacy scalar taxonomy columns in this release
- Attempting external catalog or ISBN-based classification
- Adding school targeting fields to classes or inferring a school from a class name
