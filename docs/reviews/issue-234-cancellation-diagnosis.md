# #234 종강 취소 경계와 날짜별 검증 비용

기준 main `28c66fc1938dd50a9c397cc794a697a00fa9a9ed`. 운영 재검증 [6609936881](https://github.com/tipsedu2019/tips_dashboard/issues/234#issuecomment-6609936881), [6610022394](https://github.com/tipsedu2019/tips_dashboard/issues/234#issuecomment-6610022394), [6610084691](https://github.com/tipsedu2019/tips_dashboard/issues/234#issuecomment-6610084691)을 인수했다. 기존 PR235는 표시 수정 인계 상태이며 새 취소 증상의 별도 활성 수정 담당은 확인되지 않았다. #241 코드는 수정하지 않는다.

## 관측과 확인 경로

인계받은 운영 로그에는 16:40:56, 16:42:06, 16:47:14 UTC의 writer → assert → validator 경로와 SQLSTATE `57014`가 있다. 원본 운영 로그를 이번 작업에서 조회하지 않았고, 클릭별 요청 연결·정확 취소 메시지·실행 시간은 미확정이다.

현재 client는 writer에 `AbortSignal.timeout(8_000)`과 `retry(false)`를 적용한다. 명시적인 `57014` 응답을 그대로 받으면 결과 확인으로 넘어가지 않는다. 코드 없는 transport 실패 또는 불확실 receipt일 때 별도 8초 제한의 `get_management_detail_v1` 읽기를 수행한다. 불확실 상태에서 같은 화면의 후속 클릭은 원래 확인 함수의 읽기만 수행한다. 확인 실패가 서버 rollback을 실행하는 것은 아니다.

비교는 과거의 고정 9개 필드가 아니라 실제 전송 patch 전체의 정규화된 값과 타입, kind/id/종강 상태, 등록·대기 인원 0, 두 roster 페이지의 rows/hasMore/nextCursor를 요구한다. `closed_at`은 atomic close가 서버에서 생성한다. close projection은 점유 reader와 지문을 변경하며 이 상세 확인 조건과 별개다. UI·payload·확인 조건·8초 제한을 변경하지 않았다.

PostgreSQL의 `57014`는 [query_canceled](https://www.postgresql.org/docs/17/errcodes-appendix.html)이며 발생 원인 하나를 뜻하지 않는다. 격리 PostgreSQL17.11에서 107,520개 합성 dated row의 실제 validator를 실행해 두 경우를 구분했다. 8초 statement timeout은 `canceling statement due to statement timeout`, 별도 task 소유 backend 취소는 `canceling statement due to user request`였다. 둘 다 같은 transaction의 합성 marker 변경이 rollback됐다. 후자는 PostgreSQL 취소 신호 검증이며 브라우저/HTTP 취소 전파 실험이 아니다.

## 수정의 범위와 증명

순수 종강의 재사용 적격 경로는 전체 reader 3회·validator 2회, 부적격 경로는 4회·3회다. 다른 수업의 legacy makeup이나 누락된 normalized 자원 ID도 재사용을 막는다. 기존 private proof·assert·fresh deferred finalizer와 이 호출 수는 유지한다.

기존 validator는 전체 dated 배열이 같아야 변경 없는 과거 날짜를 생략했다. 종강 projection이 미래 회차 하나를 제거해도 모든 과거 날짜가 다시 계산됐다. 새 migration은 이미 old→new 순서로 파싱한 workset에서 날짜별 raw JSON text의 대칭 `EXCEPT ALL`을 계산한다. `COLLATE "C"`와 중복 개수를 유지해 `1`/`1.0` 같은 원시 식별값 차이를 숨기지 않는다. 기존 전체 배열이 정확히 같은 경우의 빠른 경로도 보존한다.

생략하려면 canonical cutoff와 주간 weekday 입력 조건이 맞고, 유한한 해당 날짜의 dated 입력이 정확히 같으며, 그 날짜가 과거이거나 해당 요일의 주간 입력도 같아야 한다. 따라서 그 날짜의 effective 점유 개수는 증가할 수 없다. 변경 날짜, 중복 증가, 삭제로 드러난 주간 기본 일정, 변경된 요일의 상속 회차는 기존 전체 검증을 통과해야 한다. NULL/infinity·비정상 cutoff/weekday와 기존 malformed-date 오류 경계를 유지한다.

`20261103170744_timetable_validation_per_date_inputs.sql`은 기존 validator 본문 MD5 `170a6f87d5d590cc432377d33fc7d485`에서만 실행된다. 함수 OID와 본문 외 모든 pg_proc 속성이 그대로인지 확인하며 drift는 `55000`으로 transaction 전체를 거절한다. 새 table/함수·ACL/role·업무 데이터·충돌/점유 정책·timeout 변경은 없다. SQL 변경으로서 RED 검토·운영 gate를 유지한다. 현재 개발·격리 검증·draft PR 요청의 범위로 작성했으며 운영 실행 권한으로 확대하지 않는다.

## 측정과 회귀

[합성 측정 원문](issue-234-validation-measurements.json)은 단일 paired 관측이며 운영 성능 보장이 아니다. PostgreSQL17.11의 network none 컨테이너에서 공개 포트·host bind·privileged 없이 실행했다. reader/helper 14개는 최종 소스 원문이며 축소 합성 스키마를 사용했다. 실제 writer·auth/RLS·전체 migration chain 또는 결과확인 RPC 성능 측정은 아니다.

| 측정 | 기존 | 후보 | 해석 |
|---|---:|---:|---|
| 실제 reader, 84수업×128회차 | 852–901ms | 변경 없음 | 반복 reader 비용이 남음 |
| reader+validator, 120과거/8현재·미래 날짜 | 2138ms | 1972ms | 최종 함수의 약 7.8% 감소 |
| reader+validator, 과거·미래 혼합 | 2196ms | 2198ms | 초기 per-date 후보에서 개선 없음 |

앞서 전체 composite 배열 접근을 JSON 날짜 bucket으로 바꾼 후보는 10,752행 918→1331ms, 43,008행 3736→5736ms로 느려져 기각했다. 제품에 포함하지 않았다. 현재 수정도 8초 내 운영 종강 성공을 입증하지 않는다.

- 설치된 Supabase SDK의 명시적 57014/앞선 client abort/늦은 응답/읽기만 재확인 경계와 기존 종강 회귀: 23 PASS.
- 새 날짜별 fixture 9건은 축소 실제 PostgreSQL에서 45개 동등 assertion PASS. 전체 반환값·SQLSTATE·정확히 남겨야 하는 helper 날짜를 frozen oracle과 비교했다. 전체 chain pgTAP 결과는 PR의 최신 CI로 따로 기록한다.
- 실제 신규 migration의 축소 격리 적용에서 OID/owner/ACL/search_path/security 속성을 보존했고, 재적용은 55000으로 거절하며 상태를 보존했다.
- 기존 188개 migration을 유지한 신규 189번째 등록 및 변조 거절: receipt 회귀 42 PASS. 기존 legacy 허용 범위는 156개 그대로다.
- 독립 readonly Codex 검토는 정확한 후보 함수·migration·클라이언트 회귀와 날짜별 증명에서 actionable P0/P1/P2 없음. 최종 commit/tree와 전체 CI 결합은 PR에 기록한다.

전체 Supabase 이미지의 공식 mirror 다운로드는 Docker layer 등록 중 저장 공간 부족으로 실패했고 같은 pull과 기존 ECR 거부를 반복하지 않았다. 축소 진단을 full schema PASS로 바꾸지 않는다. 최신 필수 3개 CI와 실제 chain 검증은 PR 결과로 판단한다.

## 운영 인계와 복구

현준봇에게 [인수](https://github.com/tipsedu2019/tips_dashboard/issues/234#issuecomment-6610169234), [현재 확인 조건](https://github.com/tipsedu2019/tips_dashboard/issues/234#issuecomment-6610203587), [취소·성능 근거](https://github.com/tipsedu2019/tips_dashboard/issues/234#issuecomment-6610459162)를 직접 전달했다. 다음 운영 근거는 기존 로그의 정확 cancellation message와 요청 연결·duration이다. 새 저장 반복이나 확인 조건 완화는 요청하지 않았다.

운영 담당은 승인된 exact artifact와 실제 앱 DB의 이전 함수 정의·OID·owner·ACL, migration ledger, 마지막 검증 release를 확인하고 정상 runner로 인수해야 한다. 성능 전용 수정이므로 구 앱/새 앱과 RPC signature는 같다. 복구 후보는 보존한 직전 validator 정의이며 업무 행·receipt·history를 되돌리지 않는다. 실제 운영 snapshot 없이 운영 rollback SQL을 생성하거나 적용하지 않았다.

Builder는 병합·배포·운영 SQL/QA·업무 데이터 변경·이슈 종료·fixed 선언을 수행하지 않는다. 최종 운영 source/schema 확인과 원래 종강 여정의 판정은 현준봇 및 기존 운영 담당에게 남는다.
