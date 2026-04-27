# TIPS Dashboard v2 Phase 1 Checklist

## Scope
- Base app: `v2/` Next.js app
- Primary goal: admin/dashboard completeness and operational parity
- Public goal: do not rebuild public product surfaces inside `v2`
- Long-term direction: public moves to a fully separate repository with separate build/deploy ownership

## Admin Routes
| Legacy area | v2 route | Current status | Notes |
| --- | --- | --- | --- |
| `stats` | `/admin/dashboard` | Live | Core dashboard surface is active |
| `academic-calendar` | `/admin/academic-calendar` | Live | Calendar/data normalization fixes already applied |
| `academic-calendar-annual-board` | `/admin/academic-calendar/annual-board` | Live | Year overview board exists |
| `class-schedule` | `/admin/class-schedule` | Live | Workspace exists and is an active parity target |
| `timetable` | `/admin/timetable` | Live | Legacy-style grid direction restored |
| `curriculum-roadmap` | `/admin/curriculum` | Live | Workspace exists and remains in active scope |
| `students-manager` | `/admin/students` | Live | Management surface active |
| `classes-manager` | `/admin/classes` | Live | Management surface active |
| `textbooks-manager` | `/admin/textbooks` | Live | Management surface active |

## Public Routes Inside v2 (Temporary Bridge Only)
| Route | Current status in v2 | Final ownership |
| --- | --- | --- |
| `/` | Temporary redirect/bridge | Separate public repo |
| `/reviews` | Temporary redirect/bridge | Separate public repo |
| `/results` | Temporary redirect/bridge | Separate public repo |
| `/classes` | Temporary redirect/bridge | Separate public repo UI + narrow dashboard data contract allowed |
| `/inquiry` | External destination | Separate public repo / external service |

## Shared Contracts
- Auth/session remains admin-side concern for `v2`
- Public must not depend on internal admin component trees
- Shared area should be reduced to explicit APIs/payload contracts only
- `classes` is the only public surface allowed to remain data-linked to dashboard-managed information

## Temporary Bridge Rules
- Do not add new native public UX work to `v2`
- Do not continue polishing public pages as if they are part of the final admin app
- Keep bridge logic only as long as needed to avoid breaking entrypoints before public-repo cutover
- Remove bridge assets after public-repo cutover is complete

## Remaining Work
### Admin stream
- Deepen admin interaction parity and polish
- Add verification for live authenticated workflows
- Continue eliminating template leftovers from admin surfaces

### Public extraction stream
- Inventory all public routes/assets/content/data inputs
- Define separate public repo structure and deployment target
- Define `classes` API/data contract
- Move public CSS/assets/build pipeline out of `v2`
- Cut routes over from temporary bridge to the new public repo

## Definition of Done
Phase 1 is complete when:
1. `v2` stands on its own as an admin/dashboard product
2. public surfaces no longer count as v2 implementation targets
3. there is a clear extraction path to a separate public repository
4. the temporary bridge can be removed without affecting admin functionality
