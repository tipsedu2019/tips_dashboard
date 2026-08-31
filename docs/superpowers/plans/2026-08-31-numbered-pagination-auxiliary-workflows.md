# Auxiliary Record Lists and App-wide Pagination Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cover the teacher Google Chat identity record list and verify that every administrative record table uses the approved common pager.

**Architecture:** Add one bounded read beside the existing manager-only identity endpoint, retaining its protected auth.users/private-identity access. Reuse the common page controller and UI while leaving identity synchronization POST and provider behavior unchanged. Finish with a source/route applicability audit across all domain slices.

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

## Task 2: Final applicability and workflow audit

**Files:** Update`docs/qa/2026-08-31-numbered-pagination.md`; create`docs/qa/2026-08-31-numbered-pagination-coverage.md`.

**Interfaces:** One authoritative matrix names each record-list surface, adapter/RPC, sharedpager/controller use, totals, draft/export/detail contract, unit/SQL/rendered evidence and deployment prerequisites. Each excluded surface has its precise finite/date-based rationale.

- [ ] Inspect source inventory with`rg -l '<table|<Table\\b|role="table"|role="grid"|<.*DataTable' src --glob '*.{tsx,jsx}'`, and separately list card-only administrative record lists. Map management; all5taskroutes; makeup; approvaltabs; curriculum/classplanning; alltextbooktabs/settings; all5settingscatalogs; teacherhistory andGoogleChatidentities. A component usingdivs is not automaticallyexcluded.
- [ ] Search residual`loadMore`,`다음.*건`,`더 보기`, pagearrayslicing andtotalderivedfromloadedrows. Classify each actualusage: oldcursorcompatibility API, independentpicker/dateview, or a realrecordlistdefect. Fix realdefects through owningimplementationagent/review, not a source-onlytest assertingno strings.
- [ ] Recheck filters/sort/fullcount, first/middle/final/10↔11, errorretry/abort/staleauth, back/detailrestore, currentpageselection, drafts, aggregate/export scope. Verify no pipeline requiredall/intermediatepagefetch. Runcombinedrelevantregressions, finalisolatedSQL, querysurfacebudget, typecheck/lint andisolatedproductionbuild.
- [ ] Perform rendereddesktop/mobile checks onlyifpolicypermitsandnewRPCsavailable. Do notclaimappwidecompletionuntilallinscopelistsimplemented; documentanypendingbrowser/remoteapplicationseparately. Broadslicefinalreviewthencommitcoverageevidence, withnoremoteapply/deploy/send.
