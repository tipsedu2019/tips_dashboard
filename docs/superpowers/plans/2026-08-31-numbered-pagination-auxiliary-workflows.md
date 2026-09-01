# Auxiliary Record Lists and App-wide Pagination Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cover teacher Google Chat identities and statistics student/class drilldown record lists, then verify that every administrative record list uses the approved common pager.

**Architecture:** Add bounded reads beside the existing manager-only identity endpoint and the three statistics drilldown cursor APIs. Retain protected identity access and statistics invoker/RLS scope. Reuse the common controller/UI while leaving identity synchronization and statistics snapshot calculations unchanged. Finish with a source/route applicability audit across all domain slices.

**Tech Stack:** Next.js route handlers, React19, existing shadcn/Radix, Supabase/PostgreSQL, node:test, pgTAP.

**Spec:** `docs/superpowers/specs/2026-08-31-app-wide-numbered-pagination-design.md`.

## Global Constraints

- If the query-budget analyzer covers the new read service, register only its exact numbered RPC after strict10/15/20 final-SQL validation and local pgTAP proof; preserve timeout/retry/authorization checks. The owning task may update the registry and focused tests, never apply a general privileged/scalar exemption.

- Page-number blocks contain ten existing numbers: 1–10, 11–20, 21–30. No ellipses or direct page input. Single arrows move one page; double arrows select global first/last.
- Row size10/15/20; exact authorized total; direct page lookup; no all-list/intermediate-page fallback; deterministic unique order.
- Retain displayed rows/page/count on pending/error; cancel/reject stale requests; preserve drafts byrecordID and clear cross-actor data. Shared pager stays outside scrollport and mobile consumes identical rows.
- Preserve existing authentication/RLS/ACL, active-manager check, directory/manual fallback and identity revision/idempotency semantics. No provider lookup, identity mutation, send, remote migration, push, or deployment during verification.
- Ordinary new list APIs are invoker. This surface is a documented exception: its existing read requires protected auth.users and dashboard_private data. Preserve the existing narrow manager-checked SECURITY DEFINER boundary instead of granting authenticated raw access or wrapping the full-list JSON after enrichment.
- The exception does not authorize a generic privileged endpoint, relaxed manager checks, new raw table/function grants, or any change to the synchronization POST.
- Generate migration filename via CLI; promote own candidate only after actual local SQL pass and final-only rerun. Browser policy denial is not bypassed.

## Source and scope evidence

- `src/features/management/teacher-google-chat-identity-panel.tsx` is a variable-length profile record table/card mirror; `service.list()` currently loads its complete snapshot. It is not a finite configuration matrix.
- `google-chat-profile-identity-service.ts` uses `/api/admin/google-chat-identities`, bearer auth and12-second deadline. Preserve current `list`/`sync` compatibility.
- `server/google-chat-profile-identity-route.ts:get` authenticates activeadmin/staff via existing helpers, then calls actor-client `list_google_chat_profile_identities_v1`; it does not call the directory provider for GET. Existing GET rejects query parameters.
- Final source presently comes from `20260809104500_dashboard_google_chat_profile_mentions.sql`: `assert_google_chat_mentions_manager_v1` at397 checks role and active profile; `google_chat_profile_identity_json_v1` at425 joins protectedaccount/privateidentity data; `list_google_chat_profile_identities_v1` at465 checks manager before orderingname,id. Verify no later replacement before implementation.
- Notification rule tables are finite configuration; annualboard/calendar/timetable and single-class lesson timeline are temporal matrices. Keep those exclusions explicit, not inferred merely from a component name.
- `/admin/statistics` uses `StatisticsDrilldown` for student-roster, class-group and nested class-roster records. `statistics-drilldown.tsx` accumulates rows and renders `다음 30명/개`; these are actual record lists, not search pickers or aggregate charts. Task2 adds their numbered adapters. The older `SectionCards` roster popovers have no production callsite in the inspected route tree; recheck reachability during final audit instead of treating legacy definitions as active routes.

## Task 1: Bounded identity list API and shared pagination

**Files:**
- Create CLI migration `google_chat_identity_numbered_pages` and `supabase/tests/google_chat_identity_numbered_pages_test.sql`.
- Add `src/app/api/admin/google-chat-identities/page/route.ts`.
- Modify `src/features/management/server/google-chat-profile-identity-route.ts`, `google-chat-profile-identity-service.ts`, `google-chat-profile-identity-types.ts`, and `teacher-google-chat-identity-panel.tsx`.
- Create `tests/google-chat-identity-numbered-pagination.test.mjs`; retain existing route/service/type tests and `tests/teacher-google-chat-profile-identities.test.mjs` without running prohibited browser workarounds.

**Interfaces:** New RPC `list_google_chat_profile_identities_numbered_page_v1(p_page integer,p_page_size integer) returns jsonb` returns`{rows,page,pageSize,totalCount}`. New GET`/api/admin/google-chat-identities/page?page=11&pageSize=10` returns that envelope plus existing`directory,editable`metadata. Add `GoogleChatProfileIdentityPage = NumberedPage<GoogleChatProfileIdentity> & Pick<GoogleChatProfileIdentitySnapshot,'directory'|'editable'>`, `parseGoogleChatProfileIdentityPage(value)`, `service.readPage({page,pageSize,signal})`, and route factory`getPage(request)`. Import shared types from`src/lib/numbered-pagination.ts`; use the existing per-row parser unchanged. Keep original GET/POST/path/response contracts unchanged.

- [ ] Write RED service and route tests for one page11 GET, bearer auth,12s deadline/caller cancellation, no retry or full-list fallback, invalidpage/size/duplicateunknownquery400, malformedDTO502, missingRPC503, expiredactor401, teacher/assistant/viewer403, inactive manager403, no provider/service-role client calls during pageGET. Exercise the actual routefactory/transport, not a mock UI. Fixture assertion:

```js
const response = await handlers.getPage(new Request('http://fixture.test/api/admin/google-chat-identities/page?page=11&pageSize=10', {
  headers:{Authorization:'Bearer fixture-admin-token'},
}));
assert.equal(response.status, 200);
assert.deepEqual(pageRpcCalls, [{name:'list_google_chat_profile_identities_numbered_page_v1',args:{p_page:11,p_page_size:10}}]);
assert.equal(providerLookupCalls, 0);
assert.equal(serviceRoleClientCalls, 0);
```

Authenticated fixture assertions are based on valid source profiles/accounts in pgTAP, not invented admin claims. Test directSQL manager/active checks, anon ACL, no raw auth/private grants, page11/count/empty/stableties and exact22023 malformed requests. Assert old cursorlessGETandPOSTcontract tests remain valid.
- [ ] Generate migration. Copy the existing manager assertion before any protected read, use fixedsearch_path/qualified objects, ownerpostgres and authenticated-only EXECUTE after explicit revocations. Materialize narrowprofileid/name keys fromprofilesjoinauth.users for matching fullcount and page; ordernameASC,idASC, OFFSET/LIMIT before calling existing privateidentityDTOhelper for returnedIDs. Returncountonemptypage. Do not modify existing helper or create a second authorization rule.
- [ ] Extend routefactory and newGETroute with exact queryvalidation, existingauthenticate, actor-client pageRPC and request.signal propagation; keep no-store safeerror mapping. Directorymetadata remains configuration-only, with zero provider lookups. Strictly parse the response and metadata. Client`readPage` uses existingdeadline/token/errorguard with the newpath; missingnewRPCisexplicit, not legacylistfallback.
- [ ] Wire commoncontroller, `useDataTablePageSize('settings:google-chat-identities')` andDataTablePagination into table/cardmirror. Pass actoridentity/role scope from the existing auth context or parent; do not key authorization only bytokengetterfunctionidentity. Retain manualChatUserIds/profileErrors/fallbackIDs byprofileID across pages. A completed explicit sync updates onlymatchingdisplayedidentity and invalidates/refetches its page as needed; don't replace another page's rows. Navigation alone must never call sync.
- [ ] Add realhook/componentbehavior tests for page11, priorpageonerror, crossactorclear, manualdraftreturn, successfulsyncafterpagechange and common10numberbuttons. Use componentDOMtests permitted inprocess; label actualviewport checks separately. Runfocusednode/route/type/lint and actualisolatedSQL. Promoteonlyowncandidateafterpass/finalrerun, commit`feat: paginate teacher chat identity records`.

## Task 2: Statistics student and class drilldown pages

**Files:**
- Create CLI migration `dashboard_statistics_numbered_drilldowns` and `supabase/tests/dashboard_statistics_numbered_drilldowns_test.sql`.
- Add `src/app/api/dashboard/statistics/drilldown/page/route.ts` and a narrow testable server factory in `src/features/dashboard/server/statistics-numbered-drilldown-route.ts`.
- Create `src/features/dashboard/statistics-numbered-drilldown-service.ts`; modify `statistics-drilldown.tsx` and only necessary typed callsites in `statistics-workspace.tsx`.
- Create `tests/statistics-numbered-drilldown.test.mjs`; retain old statistics route/source/cursor coverage.

**Interfaces:** Preserve the existing discriminated `StatisticsDrilldownInput`. New POST `/api/dashboard/statistics/drilldown/page` accepts `{...input,page,pageSize}` (read-only transport) and returns `{ok:true,data:NumberedPage<existing kind-specific row DTO>}`. Add `readStatisticsDrilldownPage({input,page,pageSize,signal},options)` with explicit bearer-token provider and no global row cache. New invoker RPCs: `list_dashboard_statistics_student_roster_numbered_page_v1(p_subject text,p_division text,p_axis text,p_key text,p_parent_key text,p_page integer,p_page_size integer)`, `list_dashboard_statistics_class_group_numbered_page_v1(p_subject text,p_division text,p_axis text,p_key text,p_page integer,p_page_size integer)`, and `list_dashboard_statistics_class_roster_numbered_page_v1(p_class_id uuid,p_page integer,p_page_size integer)`. Preserve old cursor RPCs and original POST path unchanged.

- [ ] Verify final ordered definitions rooted at `20260813194812_dashboard_statistics_sources.sql:1134–1470` and all helpers they call. Student-roster uses distinct visible enrolled students across active classes, normalized subject/division/inferred grade, four grade/school axes and parent-key rules. Class-group uses three axes and exact split teacher/classroom tokens including newline, with existing missing-label semantics. Class-roster resolves one authorized active class byID. Preserve actual RLS, normalized-name Korean numeric order thenID, and all existing DTO fields; do not use a management-list filter approximation.
- [ ] Write RED strict service/route tests for cold page11, literal kind-specific request mapping, one target list RPC, full count, malformed DTO/envelope/input/page/size, missing RPC, bearer401 and role403, caller+8s cancellation and retryfalse. Route must verify user and the existing admin/staff/teacher role allowlist with actor client, never service role/provider. Reject unknown body fields and invalid kind-specific keys before RPC; keep no-store. Do not weaken the old endpoint to add paging.
- [ ] Generate the candidate migration with qualified invoker functions, explicit authenticated grants after PUBLIC/anon revocation, strict22023 null/enum/page/size/overflow guards and matching route role boundary. Count/page the same narrow authorized candidate keys, then enrich selected records; class counts and weekly-minute labels retain existing source semantics. Return requested page and exact total even if rows empty, leaving one bounded clamp/reload to the common controller. No full-JSON-wrapper OFFSET, cursor replay or snapshot bundle fallback.
- [ ] pgTAP covers >100 rows, duplicates across classes counted once, natural2/10 and tie order, subject/division/parent-axis inclusion/exclusion, all three kind projections, inactive/missing class, RLS/anon/role denial, malformed SQLSTATE, partial/out-of-range pages and retained cursor compatibility. Actual candidate pass precedes sole-entry promotion and final-only rerun. Add the exact three RPC registry entries only after final validation proof.
- [ ] Keep each drilldown closed/lazy until its existing open button is used. Replace accumulated rows/cursor/last-item text with a controller snapshot and shared pager. Preference `statistics:<kind>` shares row size by kind, but each input instance owns an independent page/scope; nested class rosters must not replace their parent's class page. Preserve `renderRow` and direct nested-record context. No all-row prefetch to populate a parent summary.
- [ ] Exercise real raw DTO→service→hook/component order, page10↔11, pending/error retention, unknown-vs-zero count, retry/clamp, input change atomic reset, same-ID resolved role change/logout/relogin late completions and no anonymous request. Use ready auth, clear cross-actor rows/actions immediately, and cancel on unmount/input change. Restore opened scopes/pages for Back under the existing statistics filter/navigation owner without storing row data or creating URL self-write loops. If a parent page unmounts a nested roster, retain only its validated input/page restoration state, not stale authorized DTOs.
- [ ] Run new plus affected statistics tests, TypeScript/focused lint, local final SQL and isolated build at the auxiliary slice gate. Commit as `feat: paginate statistics drilldown record lists`. No snapshot aggregate/chart redesign, writes, provider action or browser workaround.

## Task 3: Final applicability and workflow audit

**Files:** Update`docs/qa/2026-08-31-numbered-pagination.md`; create`docs/qa/2026-08-31-numbered-pagination-coverage.md`.

**Interfaces:** One authoritative matrix names each record-list surface, adapter/RPC, sharedpager/controller use, totals, draft/export/detail contract, unit/SQL/rendered evidence and deployment prerequisites. Each excluded surface has its precise finite/date-based rationale.

- [ ] Inspect source inventory with`rg -l '<table|<Table\\b|role="table"|role="grid"|<.*DataTable' src --glob '*.{tsx,jsx}'`, and separately list card-only administrative record lists. Map management; all5taskroutes; makeup; approvaltabs; curriculum/classplanning; alltextbooktabs/settings including editable subsubjects; all5settingscatalogs; teacherhistory; GoogleChatidentities; all3statisticsdrilldownkinds. A component usingdivs is not automaticallyexcluded.
- [ ] Search residual`loadMore`,`다음.*건`,`더 보기`, pagearrayslicing andtotalderivedfromloadedrows. Classify each actualusage: oldcursorcompatibility API, independentpicker/dateview, or a realrecordlistdefect. Fix realdefects through owningimplementationagent/review, not a source-onlytest assertingno strings.
- [ ] Recheck filters/sort/fullcount, first/middle/final/10↔11, errorretry/abort/staleauth, back/detailrestore, currentpageselection, drafts, aggregate/export scope. Verify no pipeline requiredall/intermediatepagefetch. Runcombinedrelevantregressions, finalisolatedSQL, querysurfacebudget, typecheck/lint andisolatedproductionbuild.
- [ ] Perform rendereddesktop/mobile checks onlyifpolicypermitsandnewRPCsavailable. Do notclaimappwidecompletionuntilallinscopelistsimplemented; documentanypendingbrowser/remoteapplicationseparately. Broadslicefinalreviewthencommitcoverageevidence, withnoremoteapply/deploy/send.
