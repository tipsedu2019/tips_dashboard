# #234 감사 선행 이력 인덱스 조회

## 승인과 범위

[소유자 RED 승인](https://github.com/tipsedu2019/tips_dashboard/issues/234#issuecomment-6652126627)을 확인했다. 기존 감사 함수의 선행 이력 SELECT만 NULL이면 `IS NULL`, 그 외에는 `=`로 나누는 forward migration이다. 초기 로컬 구현·독립 리뷰 뒤 [CI 복귀 지시](https://github.com/tipsedu2019/tips_dashboard/issues/234#issuecomment-6654229822)와 직접 사용자 지시에 따라 정식 격리 CI 등록·분리 브랜치의 정상 commit/push·draft PR 범위까지 이어간다. Builder의 병합·운영 적용/QA 권한으로 확대하지 않는다.

작업 브랜치는 `fix/234-audit-predecessor-select`, 로컬 기준 HEAD는 `e8be004bff2d682899882321a0139c1f6ed008f1`이다. 원격 main은 `0891ebea6295ce16b2983bec423717880215d0e1`로 재확인했다. 앞선 GitHub compare의 파일 차이 0건 근거를 재사용한다. 거절된 raw Git tree 조회를 재시도하지 않았으므로 로컬에 없는 main 객체를 새로 확보했다고 주장하지 않는다.

## 구현

[20261105073151_dashboard_audit_predecessor_index_lookup.sql](../../supabase/migrations/20261105073151_dashboard_audit_predecessor_index_lookup.sql)은 최종 활성 `dashboard_private.log_dashboard_audit_event_v2()` 본문의 다음 한 지점만 교체한다.

- NULL: 기존 table/format 필터와 `entity_id IS NULL`
- 비NULL: 기존 table/format 필터와 `entity_id = audit_entity_id`

두 분기 모두 기존 `SELECT * INTO`, `ORDER BY event_sequence DESC LIMIT 1`을 유지한다. `FOUND`는 분기의 마지막 SELECT 결과이며 후속 `IF NOT FOUND`의 의미를 보존한다. 빈 문자열을 NULL로 합치거나 동률 tie-breaker를 추가하지 않는다. event_sequence 동률의 특정 행 선택은 원본도 보장하지 않는다.

원본 migration은 수정하지 않는다. `pg_get_functiondef`에서 정확한 anchor 한 곳을 치환해 기존 함수의 나머지 본문을 보존한다. 원본/후보 본문 해시와 교체 횟수를 확인하고 drift이면 `55000`으로 transaction을 거절한다. 교체 뒤 OID를 포함한 모든 비본문 pg_proc 필드가 그대로인지 비교한다. 새 인덱스·table·role·ACL·RLS·function signature는 추가하지 않는다. 기존 advisory lock, sequence, 행/patch hash, 연속성 검사, 감사 INSERT와 trigger 연결을 보존한다. 설치 transaction의 제한 시간은 기존 forward migration 관례와 같은 로컬 한정 값이며 함수 설정은 바꾸지 않는다.

| 항목 | 값 |
|---|---|
| migration SHA256 | `a1122689f58791337fbc5319d1e5b192bfd640dd96af9367f46924d517ebf069` |
| 이전 prosrc MD5 | `f7951cd0fc505c7f70adff982d8a5684` |
| 후보 prosrc MD5 | `1a0d2be77da0876869cfa21505419988` |
| 이전 prosrc SHA256 | `120c0dc4a4ba275fcebe4aba905fc4072a084c325df8f7644a7211b3107bca50` |
| 후보 prosrc SHA256 | `639aaffbe2bd323573ae7fce9f8b023cf646a5f5bb82b6af9b00e45081e1aa5f` |

canonical migration 목록에 191번째로 추가하고 새 pin 및 소스 해시 검증을 등록했다. 기존 190개 prefix SHA256 `0540427a10c9506981fa03b49ea6a092585fe790c61b14bc5c205591b8e0f74b`를 고정하고, 이전 156 legacy 항목·11개 AI protocol migration 및 기존 개별 pin을 보존한다.

## 검증 근거

[기존 합성 진단](issue-234-audit-predecessor-diagnosis.md)의 28개 의미 회귀·160회 계획 측정은 입력이 같으므로 재실행하지 않는다. 실제 운영 timeout 전체의 주원인이나 8초 내 종강 완료를 입증한 자료가 아니다.

- `node --test tests/helpers/ai-producer-receipt.test.mjs`: 46 PASS, skip 0. 새 migration의 누락·중복·순서·해시·미등록 파일·소스/manifest 동시 변조 거절을 포함한다. 한 번 실행했다.
- 초기 migration 등록의 `node scripts/verify-supabase-migration-layout.mjs`: 로컬 layout PASS. 정식 CI 등록 이후 실행의 terminal 결과는 기록에서 확인하지 못했으므로 새 PASS로 합산하지 않으며 같은 검사를 다시 시작하지 않았다.
- 정식 CI 등록 변경의 관련 layout 회귀 4건: 4 PASS, fail/skip 0 (31.18초). 파일 누락·중복·변조와 checkout metadata 명령의 누락·중복·변조·순서 변경 거절을 포함한다. 이 검증은 전체 CI 성공을 대신하지 않는다.
- [실제 trigger runner](../../scripts/verify-issue-234-audit-trigger.mjs)의 [결과](issue-234-audit-trigger-results.json): 원본·후보 각각 **26 assertion PASS**, 17개 감사 이벤트 정규화 결과 동일. NULL/빈 ID, `FOUND=false`의 UPDATE/DELETE, hash/ordinal/predecessor, 정확한 `55000`/`22023`, 거절·rollback의 원자성을 확인했다.
- 실제 두 backend에서 같은 행의 transactionid 대기와 별도 행·동일 audit entity의 advisory 대기를 관측했다. 체인 ordinal 1/2/3/4, sequence 1/2/3/5의 rollback gap 및 후행 stale write의 `55000` 원자적 거절이 원본/후보에서 같았다.
- 정확한 새 migration 적용 후 OID·모든 비본문 pg_proc·owner/ACL·index/policy/sequence/trigger 정의 보존 PASS. 재적용, anchor drift, 관계없는 본문 drift, 대상 없음 4건은 `55000`으로 원자적 거절했다.
- 최초 readiness 실패는 PostgreSQL 초기 임시 server와 최종 server 사이의 소켓 공백에서 발생해 SQL 검증 전 종료됐다. task 소유 container를 제거하고 final-init 완료를 확인하도록 runner를 수정한 새 입력으로 위 검증이 통과했다. 이전 실패를 성공으로 합산하지 않는다. 성공 후 재실행하지 않았다.
- 독립 Codex의 migration·등록·실제 trigger/runtime 검토에서 제품 의미 결함은 발견되지 않았다. 최종 함수 pgTAP 요건 누락 P2는 아래 14개 assertion 파일 추가 및 변경분 독립 검토로 코드 측면에서 해소됐다. 보완 파일의 추가 P0/P1/P2는 없으나 실행은 차단돼 검증 완료로 선언하지 않는다.

실행한 trigger runner SHA256 `65de67205f9b3b7fb10fe87a3f752792b63a3121f37b0a2063ddb507e3c9b413`, fixture `ff198ffdb886c862146c7fe676cf0576560aedf3e4672dace44979da94348684`, 결과 JSON `d71531a466eb3157bf4fbcdde16dbc9b0c989320872d99c23a1eb76239e491d5`이다. 이 환경은 원본 감사 migration 전체를 적용한 축소 합성 schema/role/RLS이며 전체 Supabase migration chain·실제 인증·운영 권한 검증은 아니다.

### pgTAP의 로컬 제한과 정식 CI 등록

AGENTS.md와 [tips-quality](../../.agents/skills/tips-quality/SKILL.md)는 “Require the exact SQLSTATE evidence and a meaningful pgTAP assertion against that final definition.”을 요구한다. PostgreSQL 자체 assertion으로 이 요구를 대체하지 않는다. [standalone pgTAP fixture](../../scripts/fixtures/issue-234-audit-predecessor-pgtap.sql)의 14개 assertion은 아래 정식 격리 schema 테스트로 이식했다.

캐시된 공식 PostgreSQL17 이미지에는 pgTAP extension이 없었다. [공식 pgTAP 배포](https://pgxn.org/dist/pgtap/1.3.4/)의 `https://api.pgxn.org/dist/pgtap/1.3.4/pgtap-1.3.4.zip`을 Python urllib로 받으려던 요청은 proxy tunnel **403 Forbidden**으로 거절됐다. 파일 다운로드/설치는 실행되지 않았으며 다른 외부 경로나 재시도로 우회하지 않았다. 이 실패는 자동 승인 검토 거절 메시지가 아니라 프록시의 응답이다. 로컬 설치/캐시의 접근 가능한 범위에서도 사본을 찾지 못했다. 새 사용자 승인은 기존 정식 PR/CI의 격리 schema 경로를 지정했으며, 로컬 다운로드·거절된 OS/API 경로를 재시도하는 승인이 아니다.

추가 fixture SHA256은 `684f4fda6a103f7c447e7007b3b0e96ac94f406cfb470d46117d9972b22f4b59`다. 독립 리뷰는 `plan(14)`와 실제 assertion 14개, 최종 함수 body/trigger, NULL/빈 ID/이력 부재, 정확 `55000`과 메시지·실패 원자성·sequence gap을 읽기 검토했다. 이 보완 뒤 기존 소스/검사를 반복하지 않았다.

[정식 pgTAP 파일](../../supabase/tests/dashboard_audit_predecessor_lookup_test.sql)은 동일 14개 검사를 `pg_temp.issue234_audit_predecessor_probe`에 연결한다. 실제 최종 감사 function을 호출하되 public.classes·제품 정의는 변경하지 않고, 합성 감사행의 조회/변경/비교는 해당 probe의 entity_table에 한정한다. 이 identity가 이미 있으면 쓰기 전에 실패한다. transaction-local 빈 claims/context로 실제 viewer fallback과 nullable actor/class FK를 사용하며 사용자 인증 성공을 주장하지 않는다. 새 파일 SHA256은 `4e48c0237db19aaedd44205052b85639a35185d286080912bd461ee6065e60f9`다.

PR schema job에 이 파일 1개를 추가해 PR 전용 SQL 목록은 109개, 기존 main/AI 목록은 108개, probe는 27개로 유지한다. 임의 SQL 추가·누락·중복·명령 변경 거절을 보존한다. 같은 run block에 `git rev-parse HEAD HEAD^{tree}`를 추가해 실제 checkout SHA/tree를 기록하며 명령·위치·횟수도 검증한다. 추가 4파일(이식 pgTAP, workflow, layout verifier/test)의 독립 Codex 리뷰는 최종 SHA256 대조 후 P0/P1/P2 지적 없음으로 완료됐다. 본체 migration·등록 46개·trigger/동시성·기존 계획 측정은 입력이 같으므로 재사용한다. 실제 14개 TAP 결과는 새 CI job 로그에서 확인하기 전까지 미실행으로 구분한다.

추가 리뷰의 파일 SHA256은 workflow `185adda33fb1de8c22ea6d1bfedc76de2b5063ccd8285eb49334b11be71b06a6`, layout verifier `21a1f7296371e95a76360d1bff50e1d75874cc087d221a1b4870da2d660675aa`, layout test `f6e377e96167ad2df3e329f521c3aad3d040aa672c85c2dcac4c7e4f0058d076`이며 pgTAP은 위 파일 hash와 같다. 커밋 이후의 정확 HEAD/tree와 CI checkout SHA/tree는 PR 및 이슈의 결과 기록에 연결한다.

### 첫 정식 CI의 등록 실패와 보완

[PR #245](https://github.com/tipsedu2019/tips_dashboard/pull/245)의 최초 HEAD `720b99a069d91a41a105d90a4b0fb30f1e5adb65`에서 [schema job](https://github.com/tipsedu2019/tips_dashboard/actions/runs/42004506650/job/127167759904)은 DB/pgTAP 시작 전 `isolated_ai_parity_full_run_required`로 실패했다. workflow의 109개 목록에 비해 runner와 receipt 검증이 기존 108개만 인식한 등록 누락이다. 실제 checkout은 `ccca864479fbc36714e5a4635848d224a5276e67`, tree `6d28cac63a898bbaaeb21419c9318bb6b2608e38`로 검토한 HEAD tree와 같았다. 14개는 미실행이며 이 실패를 PASS로 합산하거나 같은 HEAD에서 rerun하지 않는다.

보완은 runner·receipt의 정확 목록 등록과 회귀에 한정한다. 기존 108개 또는 정확한 108개 뒤 승인된 audit SQL 한 개를 붙인 109개만 허용한다. 최초 요청 목록을 run 상태와 consumer에 전달해 receipt와 정확 비교하며 109→108 축소, 108→109 치환, 임의 파일/중복/누락을 거절한다. 기존 flags·probe·freshness·nonce·migration 검증은 그대로다. 새 SQL을 source closure에 포함한다. 감사 migration·pgTAP 본문·workflow는 추가 변경하지 않는다.

새 입력의 관련 회귀 3건은 3 PASS, fail/skip 0 (2.53초)다. 실제 runner가 두 승인된 전체 목록으로 process 경계에 도달하고 다른 목록·누락 flags/probe는 그 전에 거절하는 검사와 receipt/consumer 왕복을 포함한다. 기존 성공 검사는 반복하지 않았다. 보완 SHA256은 runner `1bfa2c2c70962bd3256a054ef613ef96a153b5d997230842acb2031255691a66`, receipt helper `4acc625124da6f15b7ac450c1e33bf700fb347be297339e9d85ca757693514d3`, helper test `101d9ba945001cba40f8474946cd93500d0373372252f765dd63f1581af0c5a2`다. 독립 Codex는 이 3개 hash와 기대 inventory 전달·음성 회귀를 확인했고 추가 P0/P1/P2 지적이 없었다. 아래 초기 리뷰 hash와 구분하며 새 commit의 실제 pgTAP 및 자동 CI 결과는 PR에 연결한다.

독립 리뷰의 소스 기준은 `e8be004bff2d682899882321a0139c1f6ed008f1`과 미커밋 패치다. migration SHA는 위 표와 같고, 등록 파일 SHA256은 `scripts/lib/ai-producer-receipt.mjs` = `ae9def13bd83f4d80b999bbffe89e80a0b84c520afd5264a46075fbb0ccd7d45`, manifest = `4ec0337cf6d624f005b10e5e426db239fe9b0ca778a3a66c3b7500cc11b40116`, helper test = `4ee14aff43f638ec273535e4c7e4e644c51b027a6890f9c8d053c955a47ef6d2`다. runtime 및 pgTAP 입력은 위 개별 hash로 연결한다.

## 비공개 복구 자료 요건

실제 적용 전에 운영 담당이 승인된 기존 경로에서 **해당 운영 DB의** 이전 함수 정의·prosrc hash·OID·owner/ACL·비본문 속성, trigger 연결, migration ledger와 마지막 검증 release를 캡처해 비공개 복구 자료로 보관해야 한다. 저장소의 과거 SQL만으로 실제 운영 snapshot을 대체하지 않는다. Builder는 이를 조회/생성하거나 공개 댓글에 복사하지 않았다.

필요한 복구는 별도 승인된 forward 복구 절차로 보존한 직전 함수 정의를 복원하는 범위다. 업무 행, 이미 기록된 감사 이력, sequence 값을 되돌리거나 감사 체인을 다시 만드는 절차가 아니다. 새 migration의 exact 이전 본문 guard가 실패하면 적용을 중단하고 차이를 확인해야 하며 guard를 제거하지 않는다. 실제 복구 SQL이나 운영 변경은 이번에 실행하지 않는다.

## CI 복귀와 비용·권한 경계

CI 제거 지시는 최신 소유자 댓글에서 철회됐다. GitHub connector의 repository visibility=public, PR의 필수 3개 job은 모두 표준 `ubuntu-latest`, permissions는 contents:read임을 확인했다. [GitHub 표준 runner 문서](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)에 따른 public 무료 compute 경로다. larger runner·추가 artifact 업로드·새 과금 경로를 만들지 않고 $0 예산·결제·계정·권한 설정을 변경하지 않는다. 기존 npm cache 설정은 그대로다.

workflow 삭제나 보안 gate/ruleset/branch protection 완화는 없다. PR 파일 등록과 해당 정확 hash/목록 고정만 변경한다. main push용 검증과 수동 운영 workflow는 그대로이며 feature branch push/PR로 운영 작업을 요청하지 않는다. CI 실패가 나오면 새 근거를 먼저 확인하고 같은 입력의 수동 rerun을 반복하지 않는다.
