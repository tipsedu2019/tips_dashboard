# 시간표 프리셋 최종 로컬 QA — 2026-09-23/24

승인된 로컬 구현은 완료했다. 준비 수업/옛 초안 가져오기, 제출 후 미확정 요청의 같은 탭 복구, 프리셋 단위 공유 철회, capability 실패 시 운영 읽기 유지, 긴 제목 export를 통합했다. **운영 배포 완료 보고가 아니다. 상세 구현 보고는 [Task9 report](evidence/history/task-9-report.md)에 보존했다.** main CI, 운영 migration/실제 legacy 조회, 배포, 실제 수강 전환, provider Realtime·발송은 실행하지 않았다.

작업 위치는 `/Users/hyunjun/.codex/worktrees/timetable-presets/tips_dashboard`, branch `codex/timetable-presets-20260923`; Task9 base `ed3e7a3199e1c222b274836cd5a7d3b8650a48af`, 전체 기능 기준 `eb23d7d8`다. 원래 `/Users/hyunjun/Documents/Codex/tips_dashboard` checkout은 수정하지 않았다. 사용자 `진행`은 로컬 구현 승인이고, 출시 순서는 [runbook](../../operations/timetable-presets-runbook.md)에 분리했다.

## 구현과 결과

- `list_timetable_import_sources_v1` / `preview_timetable_plan_import_v1` / `commit_timetable_plan_import_v1`를 migration·type·service·관리팀 UI로 연결했다. 준비 수업은 선택한 기본정보와 정확한 normalized slots를 새 UUID로 복사한다. 기존 class 상태/학생/이력과 옛 preference row는 그대로다. 충돌/미해결 배치는 기존 pending 편집기로 수리한다.
- historical `0d5f25e8^:src/components/NextSemesterPlannerView.jsx`의 entries **객체**와 네 독립 `planner:term` key를 처리한다. 전역 app_preferences를 actor 소유라고 가정하지 않는다. 관리팀 전용 RPC가 이름/기본정보/scheduleLines만 허용하며 nested pending에도 학생 IDs·status·unknown property·raw entry를 노출하지 않는다. source fingerprint 재검사, 현재 권한 우선, immutable receipt, 서버 provenance를 적용했다. 누락 과목은 임의 영어로 채우지 않고 명시적으로 거절한다. 실제 운영의 옛 데이터 존재/복구 여부는 미조사다.
- create/clone/rename/share/archive/restore 및 import의 **제출한** immutable body/key를 actor sessionStorage에 보존한다. metadata의 후속 입력은 원본 요청과 분리한다. reload 뒤 같은 key로 먼저 원래 receipt를 확인한다. 일반 미제출 폼은 이탈 방지만 사용한다. 서버 저장은 durable, 이 로컬 복구는 같은 탭/세션 범위다.
- 단일 프리셋 철회는 해당 item/관련 source·target transfer/관련 metadata만 폐기하고 picker 이름과 해당 controller를 무효화한다. 다른 허용 프리셋 미확정 요청은 보존한다. 로그아웃·actor/역할 변경은 전체 actor retirement와 prefix purge를 유지한다. Storage SecurityError도 처리한다.
- 이미 읽은 운영 화면은 missing RPC에서 유지된다. 실패한 프리셋/운영 참조는 마지막 좋은 grid를 남기되 새 편집/transfer/create를 막는다. 기존 active-shadow→새 draft 동작은 기본정보만 복사하고 0 slots, 원본 불변으로 확인했다.
- 공용 timetable block의 46px 미만 높이는 기존 typography로 제목을 한 줄 truncation한다. 30분/2-lane의 반쯤 잘린 두 번째 줄을 없앴다. shared token fork나 custom keyboard shortcut은 추가하지 않았다. metadata Input의 중복 autoFocus를 제거해 shared Dialog의 opener 복귀를 보존했다.

## 검증 경계와 원문

캡처한 SQL/build 원문 로그는 출력의 trailing whitespace/blank line을 그대로 보존했다. source/docs의 diff whitespace 검사는 raw evidence를 제외해 통과했다. 각 행은 독립 실행이다. 겹치는 테스트 수를 더해 총합으로 주장하지 않는다.

| 검증 | 실제 결과 | 증거 |
|---|---|---|
| timetable + 지정 regression Node 넓은 gate | 181/181, fail/skip 0; 이후 좁은 focus/revocation 수정은 아래 covering checks | [raw](evidence/task9-regression.log) |
| 현재 CI의 shared dashboard design 9개 파일 | 63/63 | [raw](evidence/task9-shared-design.log) |
| picker + interaction 후속 focused | 42/42 (20+22), 이후 picker revocation 2개 추가 | [raw](evidence/task9-final-focused.log) |
| 최종 revocation/recovery/hook/picker covering | 28/28; 새 helper RED 3 실패→GREEN 포함 | [RED](evidence/task9-revocation-red.log), [GREEN](evidence/task9-revocation-green.log) |
| full TypeScript | exit 0, 최종 focus/revocation 포함 | [raw](evidence/task9-tsc-final.log) |
| touched ESLint | 0 errors/warnings; 최초 3 warnings는 역사 로그에 남음 | [final](evidence/task9-final-lint.log), [revocation](evidence/task9-revocation-lint.log), [packaging](evidence/task9-packaging-lint.log) |
| safeenv webpack production build | exit 0, 최종 focus/revocation 포함 | [raw](evidence/task9-release-build-final.log) |
| 별도 새 DB clean ordered replay | baseline/prerequisites + 117 ordered migrations, exit 0 | [raw](evidence/task9-clean-replay.log) |
| clean replay timetable SQL 전체 11 files | **657/657**, 모든 TAP plan 합계 일치, 모든 psql exit 0 | [parsed](evidence/task9-clean-sql-results.json), `evidence/clean-*.tap` |
| migration runner non-execute 검증 | 117개 실제 SHA256, final status, capture hash 보존 | [JSON](evidence/task9-manifest-validation.json), [command log](evidence/task9-manifest-check.log) |
| 실제 DB 두 독립 browser actors | 최종 production bundle 9/9 | [JSON](task9-browser-results.json), [raw](evidence/task9-release-browser.log) |
| 390px dark/touch, keyboard, logout | 최종 production bundle 3/3 | [JSON](task9-accessibility-results.json), [raw](evidence/task9-accessibility.log) |
| offscreen long-title export | production bundle, 실제 PNG 3369×3369; 100 last-panel slots, full 09–24 axis, forced full rendering | [JSON](task9-export-results.json), [PNG](task9-offscreen-export.png), [grid](task9-long-title-grid.png) |
| 원래 root manual fixtures | 3 item revision/slots 정확히 불변 | [JSON](evidence/task9-manual-preservation.json) |
| 최종 SQL function/owner/search_path/ACL | ordered replay의 pg_get_functiondef 원문 캡처 | [JSON](evidence/task9-final-definitions-acl.json) |

SQL별 plan은 continuous 12, guard 12, makeup SQLSTATE 25, normalized 22, operational 5+5+125=135, import 29, no-send 132, permissions 24, storage 73, transfers 133, mutation safety 60이다. pgTAP stdout의 `not ok` 부재뿐 아니라 계획 수와 pass 수를 비교했다. 새 import suite의 첫 RED는 RPC가 없어 3 실패; 첫 privacy assertion은 허용된 day 값 `unknown`을 unknown **key**로 오인해 27/28이었다. 실제 sanitized preview를 확인한 뒤 property-colon 검사로 수정했고 PRIVATE/studentIds/status/raw key/nested 검사는 유지했다. 누락 과목 거절을 더한 최종 29/29는 clean chain에서 통과했다.

브라우저는 두 독립 context와 DB admin/eligible teacher를 사용했다. 관리자는 공유 철회 대상이 아니므로 teacher 권한을 실제 철회했다. create/import는 실제 DB commit 응답을 route.fetch 뒤 503으로 잃게 하고 reload→같은 body/key→한 preset을 확인했다. 다른 item의 실제 동시 DB 수정은 병합, 같은 item은 한 성공/한 `P0001/timetable_stale`였다. 한 프리셋 철회 때 **다른 허용 plan의 실제 committed request를 controller 형식 sessionStorage로 심은 fixture**가 byte-for-byte 보존되고 같은 key receipt가 한 item으로 재확인됐다. 이 다른 plan 복구 데이터의 생성은 UI fault injection이라고 주장하지 않는다. create/import/logout의 미확정 요청 생성은 실제 UI다.

참조 실패 전 선택한 수업으로 transfer가 활성화됐음을 확인한 뒤 실패 후 add/transfer/create disabled, 실제 마우스 클릭 시 mutation/transfer request 0을 검사했다. missing list RPC에서도 실제 `Task9 운영 읽기`가 남았다. export는 원래 Task8 개발모드 관찰 뒤 production bundle로 다시 실행했다. 최종 revocation/focus 변경은 export 경로를 바꾸지 않아 export를 반복하지 않았다. Mobile 첫 logout harness는 `/login/`을 기대했지만 실제 `/sign-in?next=...`에 정상 도착했다. 올바른 경로로 고친 최종 3/3만 최종 결과다([초기 harness 로그](evidence/task9-accessibility-wrong-route.log)).

Root의 직접 CUA는 prep A/B와 네 legacy 후보/teacher-weekly preview, 취소 focus를 읽기 전용으로 확인했다([dated note](evidence/history/task-9-root-browser.md)). 원래 기술 key label을 읽기 쉬운 과목/보기/중립 이전초안명으로 바꿨다. root CUA 스크린샷은 inline으로만 보았으며 저장 PNG가 없다. 위 PNG들은 별도 자동화 산출물이다.

## Task9 review I1 수정 — 미저장 입력 보호 소유자

`49faaa8e` review I1을 수정했다. picker/editor/transfer dirty를 독립적으로 보관해 OR하며, 새 plan 선택이나 transfer의 false 알림이 picker의 후속 rename을 해제하지 않는다. plan unmount는 자기 editor/transfer만 정리한다. 미제출 폼 autosave는 추가하지 않았다.

새 [실제 browser regression](../../../scripts/qa/timetable-dirty-owner-browser.mjs)은 create/clone × save/discard를 검증한다. 실제 commit 응답 손실→후속 입력→reload→동일 요청 receipt→새 plan/transfer mount 뒤 원래 metadata storage가 비어 있어도 guard 유지→native beforeunload 경고를 dismiss→저장/명시적 취소 후 guard 해제다. **RED 4/4 동일 guard 실패 → GREEN 4/4** ([RED JSON](evidence/task9-fix1-dirty-red.json), [GREEN JSON](task9-dirty-owner-results.json), [raw](evidence/task9-fix1-dirty-green.log)).

수정 covering Node56/56, fulltsc exit0, touchedlint0warning/error, safeenvbuild exit0이다 ([command/results](evidence/task9-fix1-command-results.json), [Node](evidence/task9-fix1-focused.log), [tsc](evidence/task9-fix1-tsc.log), [lint](evidence/task9-fix1-lint.log), **[최신 release build](evidence/task9-fix1-build.log)**). 기존 synthetic public read403 네 블록(M1)은 그대로 남고, narrow date wrapping(M2)도 deferred Minor다. SQL/넓은 Node/shared design/browser9/export/performance를 반복했다고 주장하지 않는다. 세부 명령·검토 disposition은 [누적 Task9 report](evidence/history/task-9-report.md#fix-round-1--review-i1-2026-09-24), [review1](evidence/history/task-9-review-1.md)에 있다.

추가 인접 테스트 경계: 최초 covering command에 포함한 `class-schedule-draft-navigation.test.mjs`는 현재/수정전49faaa8e에서15/19, 전체기능 시작점 `eb23d7d8e1e629ffcf58d0f286aafa1d33deec72`에서19/19였다. 동일 test blob을 사용했다. [현재 combined log](evidence/task9-fix1-node.log), [pre-I1 comparison](evidence/task9-fix1-unrelated-baseline.log), [origin comparison](evidence/task9-fix1-unrelated-origin.log). 테스트 helper는 update:/save_와 args.schedule_plan만 인식하지만 branch가 guarded update_class_operational_v1 + p_patch.schedule_plan으로 변경되어 네 lifecycle assertions가 새 RPC를 집계하지 못한다. **기능 이전부터 있던 실패로 면제하지 않는다.** 제품 저장 실패 자체를 증명하는 결과도 아니며, controller 지시대로 이 I1 수정에서는 인접 코드를 고치지 않고 전체 branch 검토에 넘긴다.

최신 runtime: proxy/API PID51424/session83624, releaseNext PID51931/session62682; loopback3260/3262 및3261. 모든 browser contexts 닫힘. DB reset/migration/production 작업 없음. 아래 최초 패키징 runtime은 역사값이다.

## 기존 Task1–8 증거와 현재 판정

[acceptance map](evidence/history/root-acceptance-map.md), [Task6 root 실제 UI+DB](evidence/history/task-6-root-browser.md), [Task6 report](evidence/history/task-6-report.md), [Task7 report](evidence/history/task-7-report.md), [Task8 report](evidence/history/task-8-report.md)와 [보존 파일 목록](evidence/history/INDEX.json)을 함께 본다. 과거 보고서의 당시 pending/initial bug는 이후 report/review disposition으로 읽어야 하며 현재 미해결로 재분류하지 않는다. `progress.md`와 모든 [Ruling 연대순](evidence/history/RULINGS.md), [Task9 추가 지시](evidence/history/task-9-controller-notes.md)를 보존했다.

이전 검증은 4 projection 실제 pointer/같은 slot ID, 정확한 17:13/24:00/복수요일/추천, 19 actualDB pointer cases, 7 cancellation cases(6 실제 mouse+1 한정 synthetic listener replacement), selected/bulk plan↔plan/operating copy·move, 전환 history/queue/provider no-send, 10 실제 두 연결 race를 포함한다. 이 Task9에서 변경하지 않은 전체 manual/performance suites를 재실행한 것으로 주장하지 않는다. Task8 SQL 304/304와 새 clean SQL 657은 중복을 합산하지 않는다.

## 재현 명령

모든 명령 cwd는 승인 worktree다. Node는 v24.19.0, bundled Playwright/cached Chromium, PostgreSQL 17.6. 새 패키지 설치는 없다.

```sh
NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
$NODE --test --experimental-strip-types tests/timetable*.test.mjs tests/timetable*.node.ts tests/academic-scoped-reads.test.mjs tests/management-continuous-class-schedule.test.mjs tests/continuous-class-schedule-release2-service.test.mjs
$NODE --test --experimental-strip-types tests/admin-shell.test.mjs tests/sidebar-brand.test.mjs tests/premium-semantic-contrast.test.mjs tests/common-controls-ui.test.mjs tests/data-table-surface.test.mjs tests/data-table-selection-actions.test.mjs tests/data-table-pagination.test.mjs tests/data-table-search-field.test.mjs tests/workspace-tabs.test.mjs
$NODE --test --experimental-strip-types tests/timetable-plan-recovery.node.ts tests/timetable-plan-hook.node.ts tests/timetable-plan-picker.test.mjs tests/timetable-transfer-session.node.ts
$NODE node_modules/typescript/bin/tsc --noEmit
# touched source/test files (exact argv is in evidence/task9-packaging-lint-command.json)
$NODE node_modules/eslint/bin/eslint.js src/features/academic/timetable-plan-*.ts src/features/academic/timetable-plan-*.tsx src/features/academic/timetable-workspace.tsx src/features/academic/timetable-transfer-dialog.tsx src/features/academic/use-timetable-plan-session.ts
# Stop the owned Next process before writing .next. No production env file is loaded/copied.
env -i PATH=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3262 NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-only NEXT_TELEMETRY_DISABLED=1 "$NODE" node_modules/next/dist/bin/next build --webpack
$NODE scripts/qa/timetable-manifest-check.mjs
# Refuses an existing replay name; never stop/reset the original manual DB.
python3 scripts/qa/timetable-clean-replay.py
python3 scripts/qa/timetable-clean-sql.py
python3 scripts/qa/timetable-final-audit.py
# With owned loopback fixture proxy/API and production Next:
$NODE scripts/qa/timetable-rollout-browser.mjs
$NODE scripts/qa/timetable-rollout-accessibility-browser.mjs
$NODE scripts/qa/timetable-rollout-export-browser.mjs
```

`runIsolatedSupabaseDbTests` is called with `--review-head --require-final`, without `--execute`; `validateManifestMigrations` separately validates every hash (plain non-execute plan mode alone does not). The capture baseline SHA256 remains `2d8144a9f73559bfee7f3e417e7cf6b3a9d5d6a5d059890b1db7e0c1e674942a`; catalog remains `2e4c512dc82ce947cd643f4ce850e5077005a5eb2faaccd53e2aebdcd4308f7f`. The 12 feature migration hashes are in manifest/evidence JSON; no baseline recapture.

Clean replay used a new `tips_timetable_20260923_replay` container, network none/no host ports; original `tips_timetable_20260923` was never reset. Exact auth/storage/pg_cron/pg_net/pgtap prerequisites, baseline, schema repair, notification settings prerequisites, 142000/144000/145000 content prerequisites, ordered manifests and narrow obsolete-trigger/legacy ACL reconciliation are explicit in the script/log. Old scratch bootstrap scripts were not run. No earlier whole migration was reapplied to downgrade later functions.

At packaging: owned proxy/API session 41498 PID 48390 listens only 127.0.0.1:3260/3262; owned production Next session 64177 PID 49801 listens 127.0.0.1:3261. Root owns no server. Processes may end with agent lifetime; verify lsof before reusing. Both synthetic DB containers remain available; no browser contexts remain open. Temporary DB fixtures use unique Task9 prefixes; source imports and existing manual fixture rows are preserved.

## 남은 한계와 출시 전 별도 gate

- Task8 cap 500 items/2000 slots frame p95 **33.6–33.7ms**, 목표 32ms 미달을 명시적으로 수용했다. 보통 600 slots는 17.5ms. Task9 성능 재측정은 없다. 이전 `pointerHandlerP95Ms`/`handlerEndToReactCommitP95Ms`는 instrumentation endpoint가 handler보다 먼저여서 **모든 해당 해석 철회**; 역사 로그의 0.1ms/commit lag를 제품 지표로 재사용하지 않는다. 유효한 frame/whole gesture/pure model 결과만 유지한다.
- 오래된 notification 전체 suites는 이 mixed baseline/prerequisite에서 PASS가 아니다. origin obsolete trigger DROP/legacy ACL 경계는 adapter13/writer5만 해결한다. `55000/notification_makeup_legacy_rule_missing`, import_incomplete, registry/content-contract join 0 rows, private notification_rules ACL 실패는 별개 한계로 남는다. 최신 notification control plane을 넓게 고치거나 whole old migration을 replay하지 않았다. [Task8 상세](evidence/history/task-8-report.md)와 관련 raw logs를 보존했다.
- 기존 audit DELETE FK defect 때문에 synthetic tombstone test는 실제 제품 delete API 성공의 증거가 아니다. 초기 Task1 RED 원문은 없고 이후 retained RED/GREEN을 사용한다. bounded synthetic pointer replacement는 임의 동시 하드웨어 pointer의 포괄 검증이 아니다.
- 원래 legacy preference table ACL 전면 개편, malformed missing-subject old draft의 one-click 자동수리, 새 browser session 복구는 이 구현 범위 밖이다. 네 old view는 자동 합치지 않는다.
- main CI, 운영 migration/실제 legacy 조사·복구, 배포, 실제 수강 반영, 실제 공개 cache/Realtime provider 수신 및 provider 발송은 **미실행**. 로컬 SQL/browser/release build 통과와 구분한다. Rollback은 UI capability off 재빌드·운영 읽기이며 이력/프리셋 삭제가 아니다.
