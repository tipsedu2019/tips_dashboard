# Task3 review1 — /root/review_timetable_storage, base2ca83636..a8e3f62e
Spec: issues found. Quality: Needs fixes. No Critical.

## Important1: valid legacy parenthesis resource details fail parsing
Migration20260923081138 line109 uses doubled backslash literal parentheses in a standard SQL string. Actual read-only fixture SELECT with standard_conforming_strings=on returns NULL for 월 17:13-18:43 (다른 교사, 다른 방); single-backslash control parses six captures. Existing writer creates this valid form; global incomplete_read blocks all placement. Correct escaping and execute snapshot/conflict regressions for per-slot differing teacher/room labels. Current test85 covers only no-parentheses format.

## Important2: equivalent UUID text bypasses duplicate detection
Migration line207 counts distinct raw x->>id strings; line263 stores UUID-cast IDs. Lowercase ac239000-0000-4000-8000-000000000111 and uppercase AC239000-0000-4000-8000-000000000111 pass raw duplicate check, compare as same sid (excluded from same-item overlap), and second ON CONFLICT silently overwrites first. Read-only SELECT confirmed raw predicate false vs UUID-distinct true. Validate UUID identity before duplicates; execute mixed-case/equivalent representations with distinct coordinates and exact22023/timetable_invalid + full atomic unchanged state.

## Minor
Test files line2 create extension if not exists pgtap emits NOTICE already exists in GREEN output. Clean harmless fixture initialization noise if practical; do not suppress substantive warnings/errors.

## Evidence and boundaries
Reviewer read diff in4chunks, no suite rerun. GREEN61+24 ROLLBACK and lock1/1 inspected. Two read-only SELECTs only for concrete doubts; targeted schema constraints inspected. Auth/RLS/ACL, receipts, applied exclusions and tombstones strengths. Task4 operating guards/dated sessions and Task7 transfer plus productionRealtime remain outsideTask3. InitialRED gap disclosed, not accepted as behaviorRED.
