# Public class display ordinals

Public full-class and selected-detail schedules add `displaySessionNumber` to every materialized session. A positive integer is its chronological display ordinal within an explicit, valid, nonoverlapping billing period. Only current `active` and `makeup` rows count. `exception`, `skipped`, and `tbd` rows have explicit `null`. Unknown or ambiguous data also has `null`; a stored number does not make an ambiguous row eligible.

The existing `sessionNumber` remains the stored number, with the existing omission behavior for nonnumeric values. Keep using it for registration keys such as `date:sessionNumber` and progress-log `sessionOrder` fallbacks. IDs, session keys, dates, states, resources and history are not repaired or renumbered. The new property is for DOM labels only and must never be written into a saved schedule or booking payload. Agent v2 workspace DTOs and their verification hash do not acquire an ordinal field.

Consumers must check property presence because explicit `null` is meaningful:

```js
const displayNumber = Object.hasOwn(session, "displaySessionNumber")
  ? session.displaySessionNumber
  : session.sessionNumber; // compatibility with an older response only
```

Do not use `||` or `??` to fall back to the stored number when the additive field is present. Render a counted label only for a positive integer; retain the appropriate holiday or unknown label otherwise.

For example, a corrected October 1 row can retain a stored null number and an ID ending in `skipped` while returning `displaySessionNumber: 1`. October 6 remains a holiday with `null`. October 8 can retain stored `sessionNumber: 1` while displaying `2`, and October 29 can retain `7` while displaying `8`. The ID suffix does not determine current state.

Derivation uses existing dated rows only. It never predicts weekly dates, expands a period boundary, inserts a row, or changes ownership. Invalid period definitions or duplicate identities prevent derivation. Overlapping periods, duplicate dates, missing or conflicting state/ownership, invalid dates, malformed forced flags, and unsafe cross-boundary or contradictory makeup links leave affected periods unknown. A valid independent period can still derive its own display values.

The raw serializer ignores incoming display metadata. Public payload normalization distinguishes raw `schedule_plan` from an already-projected camel-case `schedulePlan`. On public-cache reprojection, an own explicit `null` stays unknown even after private validation fields have been removed. A cached positive must equal the safely derived current counted ordinal; otherwise it becomes `null`. Older public DTOs without the property can derive from their existing valid materialized rows. All other public whitelist, cache timing, query and privacy contracts remain unchanged.
