# Class Picker and Schedule Recovery Design

**Date:** 2026-07-15
**Status:** Approved direction, written-spec review pending

## Goal

Restore every day represented by compact class schedules such as `화목 17:00-19:00` and make the class/student relation pickers faster to scan without adding explanatory UI. Unify the capacity control with the existing tuition stepper, remove repeated metadata, and make roster actions explicit.

## Confirmed Root Cause

The deployed `classes.schedule` values still contain their compact multi-day source text. A read-only production-data check found 68 classes with schedules and 41 schedules containing a compact group of two or more days. Examples include `월수금 19:10-21:10`, `화목 19:30-21:30`, and `화목 17:00-19:00\n토 12:30-14:00`.

The current editor parser matches one Korean weekday immediately before a time range. For `화목 17:00-19:00`, it therefore captures only `목`. The structured editor and summary are built from that partial parse, and saving the editor could replace the intact compact source with the partial result.

No database rewrite is required for the currently inspected records. The fix must prevent a partial parse and expand the existing source deterministically before any save.

## Schedule Parsing and Formatting

Move schedule parsing and formatting into a pure management utility so actual input/output behavior can be tested directly.

Parsing rules:

1. A compact weekday group before one time range expands into one slot per weekday. `화목 17:00-19:00` becomes separate Tuesday and Thursday slots with the same time.
2. Three-day groups such as `월수금` expand in source order.
3. Mixed schedules preserve every group. `화목 17:00-19:00\n토 12:30-14:00` becomes three slots.
4. Parenthesized per-slot teacher and classroom details are copied to every weekday represented by that group.
5. Shared class-level teacher and classroom values remain the fallback when the schedule text does not contain per-slot details.
6. Unsupported free text remains available through the existing conservative fallback instead of being discarded.

Formatting rules remain explicit:

- each structured slot is serialized as one weekday and one time range;
- when every slot shares the same teacher and classroom, those details are stored in their class-level fields and omitted from each schedule line;
- when teacher or classroom differs by slot, the differing details remain parenthesized on the affected lines.

The editor must initialize from the expanded slots and write the complete formatted schedule only after an operator changes or saves the class.

## Picker Filter Pattern

Use one compact, labelled filter surface across the three relation pickers. The surface is a two-column grid with a subtle muted background and border. Each field has a small persistent label above an existing select trigger. This keeps the meaning visible after selection while avoiding extra cards, headings, or filter buttons.

Field order:

- class textbook picker: `과목` → `세부과목`, then `학교 구분` → `학년`;
- class student picker: `학년` → `학교`;
- student class picker: `과목` → `학년`.

The current default-filter behavior remains unchanged: a class or student starts with the relevant grade, and operators can deliberately widen to all grades. Filter state remains client-side over the already loaded candidate catalog.

Empty results keep the existing immediate recovery action. No separate filter explanation or summary card is added.

## Candidate Metadata

Candidate rows keep title first and compact metadata pills below it.

- class candidates show subject, grade, schedule, teacher, and classroom;
- if the schedule repeats the same global teacher and classroom in every parenthesized segment, those repeated segments are removed from the schedule pill because teacher and classroom already have their own pills;
- genuinely different per-slot teachers or classrooms remain in the schedule pill;
- textbook candidates show subject, sub-subject, school level, and grade;
- publisher remains searchable but its pill is removed from the textbook candidate row.

## Class Fields and Roster Copy

The capacity field uses the same visual and interaction pattern as tuition: a text-based numeric input with a dedicated up button and down button on the right. Capacity changes in steps of one, never falls below zero, and does not expose the browser-native number spinner.

Roster wording becomes operationally explicit:

- `등록 학생` becomes `수강 학생`;
- the enrolled-roster removal action becomes `수강 해제`;
- waitlist actions retain their waitlist-specific wording.

## Error and Safety Behavior

- Parsing must never collapse a recognized weekday group to its final character.
- A schedule is not written merely because the detail modal opened.
- Capacity normalization accepts digits only and clamps decrementing at zero.
- Filter changes never alter existing textbook, enrollment, or waitlist links.
- Removing repeated schedule metadata is presentation-only; it does not change stored teacher or classroom values.

## Test Strategy

### Pure schedule tests

- `화목` expands to two slots;
- `월수금` expands to three slots in order;
- a compact group plus a separate Saturday range preserves all slots;
- shared teacher/classroom fallback is copied to every expanded slot;
- differing parenthesized details remain attached to the right slots;
- formatting all expanded slots preserves every day.

### UI contract tests

- capacity uses the shared stepper pattern and does not render a native number input;
- all three picker filter surfaces use persistent labels and the approved field order;
- textbook candidate metadata excludes publisher;
- shared teacher/classroom details are not repeated inside the class schedule pill;
- differing schedule details remain visible;
- roster renders `수강 학생` and `수강 해제`.

### Verification

- focused Node tests for schedule and picker models;
- TypeScript check;
- targeted ESLint;
- production build;
- browser verification in class and student detail modals, including a `화목` class and a `월수금` class.

## Out of Scope

- inferring or inventing weekdays for records whose source schedule no longer contains them;
- changing the schema or rewriting all class rows;
- changing class enrollment, waitlist, textbook-link persistence, permissions, or notifications;
- redesigning the full class-detail modal outside the annotated controls.
