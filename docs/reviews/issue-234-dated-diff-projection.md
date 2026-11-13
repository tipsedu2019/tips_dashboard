# #234 dated diff projection 재사용

종강 합성 입력에서 동일한 old/new workset의 raw-text projection을 양방향 `EXCEPT ALL`이 각각 다시 계산했다. 이번 변경은 각 측의 `(v::text COLLATE "C", dt)`를 한 번 materialize해 공유한다. 영향 날짜 열거, reader, 날짜별 충돌 검사와 결과 확인 조건은 그대로다. 전체 validator 또는 운영 저장 해결을 입증하는 변경은 아니다.

## 승인과 정확한 변경

소유자는 dated diff 중복 계산 절감 후보의 구현과 격리 검증을 직접 승인했다. 적용 범위는 `dashboard_private.validate_timetable_operating_reference_v1()`의 dated diff SELECT 한 곳이며, 이전 감사 SELECT 승인을 확대 해석한 것이 아니다. Builder의 운영 적용·병합·실데이터 변경·QA·자기 승인은 포함하지 않는다.

- 기준 main: `c4bfc710c64321a68d67834036df326f1cf7e027`, tree `424a61959dbe1736439b3f4d74294c9280d025c8`.
- [forward migration](../../supabase/migrations/20261106015549_timetable_dated_diff_projection_reuse.sql): SHA256 `133044663cec2aa4b3f1bc4ae2dab7bcafb4a57c45d7b7d574baf834639f7ea6`.
- 원본 소스 `20261103170744_timetable_validation_per_date_inputs.sql`의 135–141행에 해당하는 451-byte anchor만 교체한다. 과거 migration은 불변이다.
- 소스에서 도출한 함수 body MD5: `f43f5adf0c9ed1ed6b195de6940bb639` → `5f577a02f6ee20daf14284c62e4ded05`. 후보 SHA256 `01380283563bb443bb0e91d9ecb69b2044a0c17df68a678997e0317df29bd5f3`. 이는 저장소 소스와 합성 DB 근거이며 운영 metadata 조회 결과가 아니다.
- 원본 body hash, 원본/함수 정의의 단일 anchor, 후보 hash, 적용 후 OID·owner·ACL을 포함한 `prosrc` 외 전체 `pg_proc` 속성 동등성을 강제한다. drift를 허용하는 fallback은 없다.
- 신규 index/table/type/helper·권한·락·reader/writer·timeout/gate 변경은 없다. 기존 local migration timeout 형식을 따른다.

원문 숫자 표현(`1`/`1.0`), `COLLATE "C"`, `EXCEPT ALL` 중복, NULL-date 제외와 old→new 날짜 해석 순서는 보존한다. `changed_dated_dates`는 기존 `ANY` 멤버십에서만 사용하며, 영향 날짜 `FOR` SELECT는 바이트 그대로다. 앞선 직접 unnest 후보는 처리 순서 반례로 폐기했으며 이 패치에 포함하지 않는다.

검사 등록은 기존 191개 manifest 항목을 모두 유지하고 신규 exact pin 1개를 추가했다. 기존 prefix SHA256 `ddd04f013ef7f67687decbe57e43a903df29514971e46593f0ccf29f83407b41`을 회귀로 고정한다. SQL inventory는 기존 PR 109파일 그대로이며 workflow·계정·예산·보안 설정은 변경하지 않았다.

## 제한된 합성 검증

[runner](../../scripts/diagnose-issue-234-dated-diff.mjs), [fixture](../../scripts/fixtures/issue-234-dated-diff.sql), [전체 표본 JSON](./issue-234-dated-diff-measurements.json).

- PostgreSQL 17.11, 기존 `postgres:17-alpine` 캐시, local Unix Docker만 사용했다. 2 CPU/768 MiB/DB tmpfs 512 MiB/network none, host bind·공개 port·download 없음.
- 이전 OOM의 대형 SQL literal/PREPARE/EXPLAIN 경로와 43,008행 조건은 실행하지 않았다. 이번 한 번의 실행은 26.624초에 종료됐고, 소유 컨테이너 제거·부재를 확인했다.
- 84개 합성 수업 × 128날짜 = 10,752행. close_history는 과거 120/현재·미래 8일 중 미래 행 하나 제거, dated_equal_weekly_change는 과거 8/현재·미래 120일이며 dated 배열은 같고 weekly의 합성 teacher 값만 변경한다. 기준 날짜 2026-11-06 고정, 실제 업무 데이터 없음.
- custom/generic 각각 두 분포, 각 variant warmup 1회 후 같은 backend에서 5쌍 AB/BA 교대: 총 40측정 표본. `work_mem=4MB`, `jit=off`, statement timeout 30초, lock timeout 3초.
- 기존 20개 semantic 입력을 새 후보에 적용해 총 40사례의 독립 날짜/오류 기대값과 양측 counter·메시지·DETAIL·정확한 날짜 처리 순서를 확인했다. 성능 표본에서도 정확한 sorted/encounter/changed-date/weekday 배열과 counter가 일치했다.

각 열은 표본 중앙값(ms)이다. 전체 측정 합은 각 표본의 7개 측정 단계 합으로 계산했으며 전체 validator 시간이 아니다.

| 조건 | dated diff 원본→후보 | 측정 단계 합 원본→후보 |
|---|---:|---:|
| custom / close_history | 179.553 → 137.607 | 547.394 → 493.366 |
| generic / close_history | 168.830 → 127.756 | 518.744 → 494.278 |
| custom / dated_equal_weekly_change | 44.896 → 45.558 | 340.073 → 340.995 |
| generic / dated_equal_weekly_change | 46.881 → 46.717 | 338.665 → 336.550 |

변경 분기의 dated diff는 custom 약 23.4%, generic 약 24.3% 감소했고 10쌍 모두 개선됐다. 단계 합은 generic의 한 쌍에서 악화됐으며, 변경하지 않은 fast case는 작은 양방향 변동이 있었다. 5쌍 관측 밖의 성능·메모리 한도 일반화는 하지 않는다. actual reader, 초기 guards, 날짜별 전체 충돌 검증, writer/commit/auth/RLS 및 운영 8초 경계는 측정하지 않았다. 이전 30표본·14계획 결과는 재실행하거나 이번 결과와 합산하지 않았다.

별도의 작은 빈 합성 DB에서 정확한 이전 최종 함수 본문과 실제 forward migration을 사용해 OID·owner·ACL·`prosqlbody` 등 비본문 속성 보존을 확인했다. 재적용·본문 drift·대상 부재는 모두 `55000`이며 함수 상태 불변이었다. 이 검사는 전체 함수 호출이 아니다.

해시:

- runner: `f7521a0d2e0d43637b2278ef9489748471bbf61ce4d3ce3d1677f11ed7a1dce5`
- fixture: `0b149625e7a42462b3e60440493911f81ce7594f1ad07e2bd68283a9a7fe300a`
- 결과 JSON: `d957697ee86c2ffc4bb4105976060218b1b65a0de0191c33bf6b6f151524ce65`

## 정식 회귀와 남은 gate

[기존 workset pgTAP](../../supabase/tests/timetable_shared_validation_workset_test.sql)에 새 후보 관련 5사례와 실제 설치 함수·reader·baseline을 사용하는 복수 날짜 첫 충돌 pair를 추가했다. 이전 전체 body는 patch 역치환 후 별도의 고정 hash로 검증하므로 후보와 같은 diff helper를 oracle로 복제하지 않는다. 원문 수치/문자, 중복, NULL, fast case, old/new malformed date 우선순위, 첫 `23P01`의 비어 있지 않은 MESSAGE/DETAIL 및 helper 호출 순서를 비교한다. 기존 날짜 coverage 테스트는 후보 최종 source hash만 갱신했다.

로컬에서는 receipt/source 등록 검사 49/49, migration layout, domain SQLSTATE, diff whitespace 검사가 통과했다. 이 기록은 pgTAP 실행 결과를 대체하지 않는다. 기존 캐시에 pgTAP가 없는 한계를 우회하거나 다운로드를 재시도하지 않았으며, 추가 full-function pgTAP는 기존 정식 CI의 격리 schema 경로에서 실행한다.

독립 검토는 새 migration·등록·회귀·진단 파일의 정확한 hash에 연결한다. 필수 `free-tier-guardrails`, `supabase-sql-review`, `supabase-schema-contract`와 기존 full suites의 최종 HEAD/tested merge SHA는 PR 실행 근거로 별도 확인해야 한다. 저장소는 public이고 기존 필수 workflow는 표준 `ubuntu-latest` runner다. 수동 CI 재실행·유료 runner·예산 변경을 사용하지 않는다.

Monitor 인수에는 승인된 병합/운영 적용 절차, 원래 종강 여정 PASS가 남는다. 적용 전 정확한 artifact 전체 바이트/hash와 현재 정의의 drift 조건을 대조하고, 원본 정의·owner/ACL 등 복구 자료는 비공개로 보존해야 한다. 불일치 시 guard를 낮추거나 재적용하지 말고 중단한다. 이 문서는 운영 실행·재시도 지시가 아니며 Builder는 운영 PASS/fixed를 선언하지 않는다.
