# Lesson teacher catalog alias regression

The lesson-detail reader compared the class subject with teacher catalog subjects literally. A class labelled `영어` therefore received no choices when its teachers were labelled `영어팀`, blocking makeup saves even after the time fields were entered.

The forward migration changes only that teacher subject predicate, using the existing English, math and science team aliases. It preserves the final schedule-only payload, visibility filter, sort order, 200-row bound, SECURITY INVOKER, empty search path and existing ACL. The private alias helper stays private; the invoker reader uses the same predicate without expanding helper permissions. Classroom matching is unchanged.

Verification:

- The four new alias assertions failed before the migration and passed afterward.
- All 35 assertions in the expanded legacy schedule pgTAP test passed, including authenticated detail reads, cross-subject/hidden teacher exclusion, caller RLS, unchanged saved schedule, exact anonymous `42501`, and the earlier save/no-send regression cases.
- All 64 focused Node tests passed. The actual workspace consumes a non-empty team-labelled catalog, displays the teacher, accepts a selector change, and preserves entered makeup times and resource IDs in the save request.
- Migration layout, domain SQLSTATE verifier, Squawk 2.63.0, ESLint and whitespace checks passed.

Production application and browser evidence are recorded separately. No class data or notification mutation is part of this migration.
