# 연락처 최소화 — 최신 main 및 RPC 검토 후속

이 문서는 소스·정적·mock 검토 기록이다. DB 설치/pgTAP/ACL·RLS/rollback/경합은 실행하지 않았다. 운영 SQL, 새 RPC 권한, 배포, 실제 고객 발송, 역사 데이터 삭제는 0건이다. 보안 통제 5개 일반 평가를 반복하지 않았다.

## 기준선과 보존

- 2026-10-09 11:09:24 UTC에 연결된 GitHub 읽기로 `main=4a2cda49ee4e92aa45ddb300c8b86e9ece9fddba`를 확인했다. 승인된 원격 소스 fetch는 격리 `/tmp` bare repository만 갱신했다.
- 이전 후보 `15c22216f8ed29ad5e78735240cb2bb264f98d6a`는 `6a6d7abe4f45e366beccc14efbbcce0534f0370f` 기반이었다. 그 사이 원격은 13 commits/57 files를 변경했다.
- [PR126](https://github.com/tipsedu2019/tips_dashboard/pull/126) merge `8425e9f8fb2a98bf53881fc1c5a577d1c7200cc3`: 전반 사전 제외·목적반 기등록, 신청/적용 사실 분리, NULL actor guard. [PR127](https://github.com/tipsedu2019/tips_dashboard/pull/127) merge `4a2cda49`: Chat 답글 전용 무기한 키.
- 운영 적용 ledger `20261009093017`, `20261009093058`, `20261009101529`와 앱 배포 완료는 상위 작업 보고 및 PR 기록이다. 이번 작업에서 운영 DB/배포 endpoint를 다시 읽거나 적용하지 않았다. 원격 소스 확인과 실제 운영 상태 검증을 구분한다.
- 새 로컬 소스 통합 commit `667102f7d5d491096976a621eaf7973970320677`, tree `d8240d3e276bc4568a7b781922d9b68bbd24e593`. 이전 후보와 최신 main을 부모로 둔다. 원격 push/PR merge/deploy는 없다.
- 실제 중복 파일은 `ops-task-service.ts`, `ops-task-workspace.tsx`, `dashboard-free-tier-v1.manifest.json` 3개다. `git merge-tree` 텍스트 충돌은 0이다. 텍스트 병합 성공이 SQL 의미 호환성을 입증하지는 않는다.
- 원래 dirty repository, AI 동시 작업 worktree, `7044ace6`/`83ac8b5e`/`15c22216`의 frozen source와 이전 release는 보존한다. 후속 변경은 `/tmp/tips-privacy-main-integration-20261009`에만 있다.

## 정확한 RPC 3건

| 정적 검사 caller | RPC | 기준선/도입 구분 | 실제 계약 |
| --- | --- | --- | --- |
| `registration-contact-command-route.ts:submitContactCommand` | `mutate_registration_contact_v1(uuid,text,uuid,text,bigint,bigint,jsonb,text)` | main에는 없음. 직접 caller는 `83ac8b5e` 도입. `15c22216`은 binding receipt 검증만 보완했다. | actor·단일 사건·요청 키의 원자 명령이며 JSON receipt 하나. 128KB HTTP 입력 및 과목 최대3 제한. 페이지 인자 없음. |
| `registration-customer-message-bundle-preview-route.ts:readBundleContactFence` | `read_registration_contact_message_fence_v1(uuid,text,uuid)` | 새 연락처 경계 후보; 직접 caller는 `83ac8b5e` 도입. | actor·선택 source·kind의 fence metadata 9개 필드. 페이지 인자 없음. |
| `registration-customer-message-bundle-preview-route.ts:readBundleSource` | `resolve_registration_customer_message_bundle_source_v1(text,uuid,date)` | RPC와 기존 익명 caller는 main에도 존재. `83ac8b5e`에서 literal typed helper로 이동하고 timeout/retry(false)를 추가했다. | 선택 사건·kind·date의 complete bundle JSON. 최종 collector 성공 결과는1..3 items, 중복 과목 거절; 저장 item은 sort_order1..3+PK. 페이지 인자 없음. |

읽기 RPC의 새 ACL은 withheld이다. 같은 이름의 기존 bundle resolver는 CREATE OR REPLACE/OID·owner·ACL 보존 후보이며, 새로운 공개 권한을 추가하지 않았다.

재현 matrix: `main6a→83ac` FAIL3, `main6a→15c` 동일 FAIL3, `83ac→15c` PASS0. 마지막 PASS는 변경 occurrence만 검사하여 기존3 caller를 다시 검사하지 않은 결과이며 해결을 의미하지 않는다. `main6a→main4a` tasks gate는 PASS0, `main4a→667102f7`는 같은 FAIL3다.

완전한 파일 검사에서 main6a/main4a 기존 bundle 익명 호출은 `list_query_receiver_unresolved`다. 따라서 **운영 기준선에 같은 rpc_page_limit_missing3건이 있었다**고 말하지 않는다. 기존 RPC의 분류/호출 분석 문제가 있고, 새 후보의 두 RPC 및 typed caller에서 페이지 계약 미등록이 드러난 것이다.

`query-surface-budget.js`는 등록된 정확한 비페이지 RPC 외에는 `p_limit`를 요구한다. 여기서 `p_limit:1/30`을 추가하면 SQL signature를 변경하거나 호출을 실패시키며, 단일 JSON·cleanup fanout을 제한하지도 못한다. `.limit(1)`도 JSON 내부 집합을 제한하지 않는다. checker/registry/debt 예외 추가, 동적 호출 은폐, assertion 완화는 하지 않았다.

단일 JSON은 내부 비용 상한의 증거가 아니다. 사건 종결은 그 사건의 과거 previews/messages/jobs/bundles 전체를 retire한다. 이 작업을30개로 자르면 종결 안전성을 해친다. bundle collector는 집합을 aggregate한 후 count>3을 거절하므로 중간 집합/이력 fanout 비용은 별도 검증해야 한다. 정확한 final SQL·scope·bounds·auth·ACL·idempotency 및 SQLSTATE/pgTAP 증거 없이 비페이지 registry 통과를 표시하지 않는다.

## 최신 main과의 최소 소스 수정

1. **PR126 전반 구현 보존.** 이전 UUID draft는 PR126 이전 full transfer body를 포함하고 있었다. exact prosrc preimage guard는 최신 함수에서 `55000`으로 중단할 것으로 예상되지만, hash만 갱신하면 이미 적용된 전반 수정을 덮어쓴다. 기존 ordered-source helper도 새 동적 migration을 처리하지 않아 old transfer를 final로 잘못 반환했다. 후속 helper는 정확한 PR126 migration hash·각 anchor·6개 domain SQLSTATE 교정을 순서대로 재구성한다. 해당 최종 본문에서 UUID-only identity/created_at rescan 변경만 적용하며 신청/적용 snapshot, 사전 제외·목적반 기등록, claim invariant, status, locks, 실제 `40001` 충돌을 보존한다. 운영 migration을 재적용하지 않는다.
2. **PR96·PR127 source 검증 동시 보존.** merged manifest에는 PR96의 정확한 SQL2개가 있으나 AI producer 검증은165 inventory/legacy156을 기대하여6개 source/mock 시험이 실패했다. PR96 파일·SHA를 독립 명시핀/closure로 추가하고 정확한 inventory167을 검증한다. 기존156 prefix SHA, AI11개, PR1262개, PR127 Chat pin은 그대로다. 삭제·중복·순서·hash·status·filename·동시 source/manifest drift·누락 SQL 거절을 추가했다. 임의 추가 파일을 허용하지 않는다.
3. **다른 fence caller의 I/O 보호.** single-source 발송 adapter도 같은 fence를 generic RPC helper로 읽고 있었고 그 새 호출에8초/retry(false)가 없었다. 이 fence만 literal typed helper로 분리하여 timeout과 no-retry를 붙인다. 기존 generic helper 전체를 바꾸지 않는다. 이로 인해 gate가 추가 fence caller를 인식하면 추가 비페이지 계약 실패를 그대로 보고한다.

## 연락처 최소화 완성에 필요한 잔여

- **배포 차단:** 허용된 격리 DB에서 최종 ordered 설치·정확 SQLSTATE/pgTAP·ACL/RLS·rollback·종결/claim/marker race를 검증해야 한다. 직접 승인 전 실행은0이며 자동 승인 거절 우회도0이다. 새 RPC 권한과 앱 cutover는 별도 허용 범위에서만 검토한다.
- **비페이지 계약:** 위3 RPC와 새로 명시된 동일 fence caller의 exact contract를 DB 증거에 묶어 검토한다. 등록은 해당 이름에만 적용하고 unknown RPC, timeout 누락, retry 허용, 다른 signature/caller의 negative cases를 유지한다.
- **복합 발송 목적 fence:** candidate bundle fence는 ANY eligible current track을 확인한다. legacy collector는 archive/예약 사실을 필터링하지만 각 item의 manual workflow 종결/관찰 단계 조건까지 보장하지 않는다. 열린 과목 하나와 종결됐지만 scheduled fact가 남은 다른 과목의 혼합 사례를 각 constituent별 검증해야 한다. 숫자≤3만으로 목적 준수가 입증되지 않는다. 현재 preview/activation/no-send 경계는 유지하며 운영 발송 재현은 하지 않았다.
- **HTTP 원문 최소화:** 기존 numbered reader가 전화 JSON을 반환하므로 UI DTO projection만으로 전송이 사라지지 않는다. Stage1 reader-minimization SQL을 최종 정의에 통합·검증하고 client/server/lifecycle/UUID/fence와 함께 cutover해야 한다.
- **기존 사본:** 기존 Data API의 원문/UUID 쓰기·읽기 권한, 자유 메모, 역사 감사·사본·백업은 이 소스 수정으로 삭제되지 않는다. 별도 범위·보존 의무·승인된 정리 계획이 필요하며 이번 purge는0이다.

## 증거와 실행 상태

최종 실행 수·정확 source hash·독립 리뷰는 전달 패키지의 `validation-manifest.json`, `source-manifest.json`, `evidence/`를 따른다. source-only Node 시험은 SQL 실행 증거가 아니다. 첫 실패 로그도 보존한다. 기존 browser84/84는 frozen15c의 같은 학생 연결 UI fragment에 대한 증거이며 최신 전체 운영 배포 검증으로 확대하지 않는다.

자동 승인 검토는 격리 합성 DB 재생성을 실행 전에 거절했다. 신뢰된 직접 승인이 읽기 전용 범위였고 전달된 추가 승인만으로 DB 쓰기·테스트를 허용할 수 없다는 이유였다. 이 후속에서도 DB 재시도/우회/운영 DB 대체는 하지 않았다.
