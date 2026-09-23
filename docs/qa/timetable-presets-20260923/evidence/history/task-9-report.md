# Task9 implementation report

Status: implemented and locally verified; independent Task9 review remains parent-owned. Base `ed3e7a3199e1c222b274836cd5a7d3b8650a48af`; approved worktree only. No push/deploy/prod access, real promotion, external sends, installs, reset of original DB, or new subagent.

## Implemented

Manager-only preparation and historical four-key legacy imports: CLI-created migration `20260923150523_timetable_plan_import_recovery.sql`, public list/preview/commit RPCs, private whitelist parser, source-fingerprint CAS, current authorization before receipt, server UUID/provenance, safe nested pending retention, source/history no-mutation. Legacy entries are object; missing subject explicitly rejects `22023/timetable_import_metadata_missing`. Manager UI shows human readable labels and uses existing placement repair. New import unknown receipt persists same immutable command/key/fingerprint across reload.

Metadata create/clone/rename/share/archive/restore now persist submitted request and separate followup fields in actor-scoped sessionStorage; unsubmitted forms retain only dirty-navigation protection. Prefix purge and synchronous retirement on logout/actor-role change, SecurityError warning, load-current-receipt before second intent. Actual same-key create/import lost-response reload DB proofs.

Root final named finding fixed: single-plan 42501 formerly retired the whole actor. `clearTimetablePlanRecovery` + scoped listeners now remove only revoked plan item recovery, related source/target transfers and related metadata, picker names/current dialog/controller. Other permitted-plan submitted bytes remain. Actor-wide auth retirement unchanged. Tests cover related/unrelated metadata and real teacher share revocation with another allowed plan's actual committed request saved as controller-format recovery, followed by exact same-key receipt.

Failed reference retains good grid/operating read, disables new controls including previously enabled transfer; real disabled-control clicks produce zero mutate/transfer requests. Missing RPC preserves actual operating read. Active shadow existing new-draft action verified basic-only/zero-slots/source unchanged. Compile-time NEXT_PUBLIC_TIMETABLE_PRESETS_ENABLED=false disables preset entry for non-destructive rollback.

Shared small-block single-line truncation fixes half-visible second title line; existing font and tokens retained. Removed duplicate Input autoFocus so shared Dialog captures opener; actual keyboard/mobile focus verified. No custom shortcuts.

## Commands and results

All cwd `/Users/hyunjun/.codex/worktrees/timetable-presets/tips_dashboard`. `NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node` (v24.19.0). Exact durable logs in `docs/qa/timetable-presets-20260923/evidence/`; QA REPORT contains linked traceability and boundaries.

- `$NODE --test --experimental-strip-types tests/timetable*.test.mjs tests/timetable*.node.ts tests/academic-scoped-reads.test.mjs tests/management-continuous-class-schedule.test.mjs tests/continuous-class-schedule-release2-service.test.mjs` — exit0,181/181,skip0. One broad gate, before final scoped focus/revocation changes.
- `$NODE --test --experimental-strip-types tests/admin-shell.test.mjs tests/sidebar-brand.test.mjs tests/premium-semantic-contrast.test.mjs tests/common-controls-ui.test.mjs tests/data-table-surface.test.mjs tests/data-table-selection-actions.test.mjs tests/data-table-pagination.test.mjs tests/data-table-search-field.test.mjs tests/workspace-tabs.test.mjs` — exit0,63/63, actual current CI list.
- `$NODE --test --experimental-strip-types tests/timetable-plan-picker.test.mjs tests/timetable-plan-interaction.test.mjs` —42/42 after SecurityError/labels; later picker adds2 revocation cases.
- `$NODE --test --experimental-strip-types tests/timetable-plan-recovery.node.ts tests/timetable-plan-hook.node.ts tests/timetable-plan-picker.test.mjs tests/timetable-transfer-session.node.ts` — final28/28, exit0. These counts overlap previous suites and are not summed.
- `$NODE node_modules/typescript/bin/tsc --noEmit` — finalexit0 including focus/revocation; task9-tsc-final.log.
- `$NODE node_modules/eslint/bin/eslint.js <20 touched source/test/QA script paths>` — finalexit0,0warnings/errors. Exact full argv task9-packaging-lint-command.json, clean stdout task9-packaging-lint.log. Earlier focused warnings are retained history, superseded.
- `env -i PATH=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3262 NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-only NEXT_TELEMETRY_DISABLED=1 "$NODE" node_modules/next/dist/bin/next build --webpack` — finalexit0, task9-release-build-final.log. Includes latest focus/revocation. Expected public read fallback messages from synthetic build env are present; not a production data read. Stopped owned Next before each required source-change rebuild, no concurrent .next writer.
- `python3 scripts/qa/timetable-clean-replay.py` — new separate networknone/noports container tips_timetable_20260923_replay, baseline/prereqs+117ordered passed; refuses already existing name. Original tips_timetable_20260923 untouched. No destructive old bootstrap script.
- `python3 scripts/qa/timetable-clean-sql.py` —11files657/657, every psql exit0, all TAP plans parsed and exact totals checked. plans continuous12,guard12,makeup25,normalized22,operational5+5+125,import29,nosend132,permissions24,storage73,transfer133,safety60. Individual clean-*.tap logs plus task9-clean-sql-results.json.
- `$NODE scripts/qa/timetable-manifest-check.mjs` — finalexit0, read-only --review-head --require-final + explicit validateManifestMigrations,117actualhashes. Initial packaging script selected immutable capture rather than current reviewed manifest and correctly failed incomplete; fixed to --review-head, no product/migration change. Capture baseline/catalog hashes unchanged.
- `python3 scripts/qa/timetable-final-audit.py` — exit0 finaldefinitions/ACL captured and originalmanual3items revisions/slots exact unchanged after finalbrowser.
- `$NODE scripts/qa/timetable-rollout-browser.mjs` — finalexit0,9/9 actual isolatedDB independent contexts/actors. New failure-control request assertion verified zero; permitted recovery boundary explicit above.
- `$NODE scripts/qa/timetable-rollout-accessibility-browser.mjs` — finalexit0,3/3 mobile dark/touch readable labels/nooverflow/Escapefocus, Tab/Escapefocus, actual logout clears submitted metadata + token. Initial /login/ expectation wrong; observed actual /sign-in route then corrected harness; initial log kept.
- `$NODE scripts/qa/timetable-rollout-export-browser.mjs` — production bundleexit0, realPNG3369x3369,100lastpanelblocks/fullaxis09–24/two-lane30minlongtitles/forcedfullrendering. After this export only focus/revocation code changed, no export path change; no unnecessary performance rerun.

## TDD and corrections

Metadata RED: `git show HEAD:src/features/academic/timetable-plan-picker.tsx > /tmp/timetable-task9-baseline-picker.tsx`, `TIMETABLE_PICKER_SOURCE=/tmp/timetable-task9-baseline-picker.tsx $NODE --test --experimental-strip-types tests/timetable-plan-picker.test.mjs`:18tests,12pass6fail, exactly create/clone/rename/share/archive/restore fullremount. GREEN19 then20(SecurityError),final22picker within28covering.

Import RED: socketpsql to approved existing synthetic DB with to_regprocedure pgTAP checks:3/3fail absentRPC. CLI migration creation then application, full import pgTAP GREEN29/29 cleanordered. Initial27/28 privacy regex matched allowed day value unknown; actualpreview had no leaked property. Corrected regex to unknown-property-colon, kept PRIVATE/studentIds/status/rawentry/nested checks. SQL fixture setup corrections (own auth catalog auto-row/email/table schema/guard metadata) are preserved in historical logs; no claims that interim greenfilename meant pass.

Plan revocation RED: new `tests/timetable-plan-recovery.node.ts`3tests fail missing scoped helper before sourceedit. GREEN3 plus existinghook/picker total28. Parent identified actorwide purge; fixed before finalcommit. Focus actual acceptance initially failed due duplicate autoFocus; sourcefix verified in final3/3 productionbrowser. No unsupported handler timing claims retained.

## Durable evidence, files, self-review

`docs/qa/timetable-presets-20260923/REPORT.md` is the maintained final cross-task report. `docs/operations/timetable-presets-runbook.md` defines schema→backfillNONE→ACL/finaldefs→capability→UI→operatingread and UI-off nondelete rollback. All previously untracked feature plan/spec intentionally included. DESIGN aligned. `evidence/history` preserves prior reports/reviews/rawlogs, rootmanualnotes, controller constraints and chronological RULINGS; INDEX lists files. This report is copied there so final references do not depend on ignored scratch. No scratch force-add.

Changed source: import RPC migration/pgTAP; plancontract/service/importdialog/picker/recovery/model/session/workspace/transferdialog; shared legacygrid/CSS; manifest; fixture bridge/server/seed; new cleanreplay/sql/audit/manifest/browser scripts; picker/recovery tests; docs/spec/plan/DESIGN/QA evidence. Exact list in git commit. No unrelated UI/style rewrite.

Self-review: fixed actorwide revocation scope, preserved unrelated pending and listener lifetime; no manual business40001; whitelist handles nested pending; currentauth before old receipt; typed commandbody survives reload; source rawpreferences/classes unmodified; knownactorfixture has no productionfallback; originalmanualDB neverreset. Source/docs diff --check excluding raw evidence is clean; unmodified captured SQL/build logs retain their original trailing whitespace/blank lines (full cached check reports those). All scoped touched ESLint clean. Broad tests ran once, covering finalchanges rerun. Parent Task9 fresh review still required, not self-certified.

## Limits and ownership

Inherited Task8 cap33.6–33.7ms >32ms target accepted explicit unmet; normal600slots17.5ms. Old handler/commitlag measurements invalidated entirely; use only retained independent frame/wholegesture/puremodel. No newperformanceclaim. Historical oldnotification whole suites notPASS: obsolete-trigger/legacyACL boundary only fixes adapter13/writer5; missingregistry/contentjoin/55000legacyrulemissing/importincomplete/privateACL remain. ExistingauditDELETEFK defect onlysynthetictombstoneboundary. InitialTask1rawRED absent. Bounded synthetic listener replacement notarbitraryhardwaremulti-pointerproof. No providerRealtime/mainCI/prodlegacyread/migration/deploy/realpromotion/provider send.

Latest runtime checked: proxy/API session41498 PID48390 ports3260/3262 loopback; releaseNext session64177 PID49801 port3261 loopback; rootnoownedserver. Existing + replay DBs networknone/noports retained; allbrowsercontextsclosed. Processes may terminate with agent lifetime; verifylistenerliveness before reuse. Rootmanual3fixturepreservationJSON refreshed after browser. No PR/task created; localcommit only.
