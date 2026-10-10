# 학생 연락처 최소화 구현 검토본

기준은 `tipsedu2019/tips_dashboard`의 main `6a6d7abe4f45e366beccc14efbbcce0534f0370f`이다. 원본의 dirty HEAD, 진행 중인 AI 작업공간, 미설치 후보 `0e6a4a3effff86c5c7974b688084e672b7e9804b`를 운영 근거로 사용하지 않았다. 이번 코드는 독립 branch에서 새로 작성했다. 운영 SQL·배포·발송·계정/권한 변경·과거 데이터 정리는 수행하지 않았다.

사용자 정책은 학생 기본정보 **이름·학교·학년·원생번호**와 업무 기록의 보존, 등록 단계의 **레벨테스트 안내·청강 안내·등록 안내**에 한정한 일시적 연락처 사용이다. 전체 등록 단계가 끝나면 연락처 사용을 끝낸다. 30일 기본 보관이나 UUID 연결·정산·발송 결과 확인을 이유로 한 연락처 보관 연장은 도입하지 않는다.

## 이번 변경의 단계

| 단계 | 구현 | 범위와 한계 |
| --- | --- | --- |
| A: 학생 앱과 reader | 연락처 표시·입력·검색·정렬 제거, 학생 저장 payload에서 키 제외, 직접 앱 읽기/변경 반환 projection 축소, 네 기존 RPC의 연락처 null 응답 초안 | 기존 값 삭제 없음. Direct Data API의 기존 SELECT/UPDATE 권한 차단과 등록 연락처 제거를 완료한 것은 아님 |
| B: 감사와 외부 매핑 | 학생의 미래 감사만 연락처 필드를 제외하는 `privacy_v3` 및 빈 nullable `makeedu_detail_id`의 같은 transaction 초안 | 독립 검증 후보. 과거 행·audit·receipt를 변경하지 않음. 기존 v2 기록의 timezone을 확인하지 못하면 첫 write가 `55000`으로 막힐 수 있음 |
| C: 등록 생명주기와 발송 | 전체 종결/명시적 취소·마지막 과목 제외·새 세대 재개·exact replay·발송 gate 순수 모듈 및 합성 시험 | 기존 등록 route/service/SQL에 아직 연결하지 않음. DB 잠금/원자성, actor/task에 결합한 서버 HMAC, 실제 provider 경합 시험을 증명하지 않음 |
| D: 과거 복사본 정리 | 저장소·이력·receipt·클라이언트 cache·export·backup별 계획 | 실행 시점에 별도 승인이 필요한 영구 정리. 이번 후보에는 정리 SQL/작업이 없음 |

각 단계의 코드와 SQL 초안은 리뷰용이며, `docs/security/sql/`은 자동 migration 경로가 아니다. 최종 설치본을 만들 때 새 CLI-generated migration, immutable manifest와 exact preflight를 단일 통합 담당자가 함께 검증해야 한다. 초안의 one-shot source guard를 CLI migration ledger의 멱등성 대신 사용하지 않는다.

## 학생과 MakeEdu

학생 내부 `students.id` UUID와 수강/대기 배열·enrollment·class roster·수업시간·출결·교재·정산·퇴원 이력은 연락처와 별개다. 기존 master 값을 null/빈 문자열로 지우기 위해 화면 저장 요청을 사용하지 않는다. 생성/수정의 전화 키를 아예 생략한다. 이 단계만으로 기존 서버 write 경로나 v2 감사의 새 raw 복사를 막았다고 주장하지 않는다.

`uid`는 표시 원생번호, `makeedu_student_no`는 기존 교재 결제 import 계약, `makeedu_detail_id`는 별도의 외부 상세 URL 토큰이다. 어느 것도 다른 값을 추정하는 근거가 아니다. 공식 `https://school.makeedu.co.kr/member/student/list_detail.do?studNo=...`의 정확한 origin/path와 단일 query를 검사하고 저장값으로 URL을 재구성한다. 임의 URL·추가 query·credentials·fragment·명시 port는 거절한다. 확인된 매핑이 없으면 원생번호는 일반 텍스트다. 현재 A producer는 매핑을 null로 반환하며 새 입력/저장을 제공하지 않는다.

구조 검사는 해당 학생과의 실제 연결, 테넌트 권한, 로그인 후 접근, 링크 안정성의 검증이 아니다. 검증된 연결의 입력 절차와 실제 공식 URL의 장기 계약이 확정되기 전에는 nullable 연결 UI를 운영 완료로 보고하지 않는다. 매핑이 없는 것은 연락처 보관 연장 사유가 아니다.

## 단일 담당자가 연결할 등록 경계

1. **사실과 잠금:** 화면의 완료 탭은 사용하지 않는다. parent case 잠금 아래 현재의 미archive 과목 전부와 persisted contact phase/generation/revision을 읽는다. 현재 과목 0개만으로 완료를 추론하지 않는다. 명시 전체 취소 또는 마지막 과목 제외는 별도 guarded 의도로 처리한다.
2. **종결 transaction:** 세 목적이 모두 닫힌 case의 typed 연락처를 비우고 stale common/inquiry 저장·새 발송 준비·claim·attempt를 같은 parent/generation protocol로 차단한다. 과목 첫 종결만으로 다른 현재 과목의 연락처를 제거하지 않는다. 이력/receipt에는 contact presence, 변경 필드, 이유, actor, request key 등 최소 사실만 남긴다.
3. **재개:** `generation + 1`, 새 요청키와 revision을 사용하며 기본 연락처는 null이다. 이전 이력·receipt·예약·브라우저 초안에서 연락처를 복구하지 않는다. 새로운 목적의 사용자 입력만 받는다. UUID와 업무 이력은 그대로 보존한다. generation/revision은 양수 PostgreSQL bigint 범위를 사용하고 overflow는 상태 변경 전에 거절한다.
4. **멱등성:** exact actor/request key/full-command keyed digest를 stale 검사보다 먼저 확인해 저장된 결과만 반환한다. digest는 trusted server가 case·actor·generation·목적·canonical source identity·전체 요청을 결합해 계산한다. HTTP가 보내는 digest나 승인 플래그를 권위로 받지 않는다. reducer의 `state`는 연락처를 포함하는 내부 상태이므로 HTTP/event/receipt에 통째로 직렬화하지 않는다. 응답은 명시적으로 `receipt.result` 또는 정책 모듈의 result whitelist에서 만든다. 새 key provisioning이나 기존 비밀 조회는 이번 작업에 포함되지 않았다. legacy receipt는 이 단계에서 rewrite하지 않는다.
5. **발송 경계:** 기존 7종 기능과 label을 유지하고 세 목적 사용 여부만 구분한다. `admission_application`은 등록 안내 매핑 후보이며 자동 허용하지 않는다. 준비→claim→attempt marker 직전마다 locked phase/generation/source 사실을 다시 확인한다. 현재 DB enum에 없는 `canceled` 상태를 임의로 기록하지 않는다. attempt 전 준비/claim은 현 계약에 맞게 취소하고, 이미 시작한 결과 불명 요청은 최소 request/provider ID와 결과 상태를 보존하며 자동 재발송하지 않는다. 공급자 접수는 실제 도착을 뜻하지 않는다.
6. **실제 경합 증거:** current final 함수와 실제 route를 연결한 뒤 두 PostgreSQL 세션으로 종결↔common-save, 종결↔claim/attempt, 재개↔old-generation, exact replay, duplicate bind를 검증한다. 순수 모듈의 합성 시험을 DB 원자성이나 운영 발송 증거로 대체하지 않는다.

## PR96·공유 finalizer 통합 순서

PR96의 PR125 통합 handoff 기준 tree는 `3453a32f8d58b6012d389f01207d3be27b88e7af`이며 아직 uncommitted/unpushed 후보다. 기존 PR96 두 migration과 PR125 이력 actor/time provenance를 그대로 보존한다. 이번 후보는 PR96 소유의 registration editor/service/history/workflow를 수정하지 않았다.

앞으로 `set_registration_workflow_status_v1`, waiting saver, observation manager/booking 함수에 privacy를 연결하려면 **PR96 full replacement를 먼저, privacy 후속 migration을 뒤에** 놓고 source anchors·owner/ACL·catalog·시험을 다시 확인해야 한다. 이번 A management reader와 B audit/link 초안은 해당 네 함수에 변경을 넣지 않는다.

`finalize_registration_track_enrollments_v1`과 withdrawal/transfer의 공통 protocol은 전반 작업 담당자와 같은 single integration owner가 다룬다. 이번 후보는 finalizer를 수정하지 않았다. 기존 parent→track→학생 identity/advisory→student row→batch/claim→class→queue 순서의 교착 방지 의미, 마지막 수업일·신규 등록 roster·exact idempotency와 실제 concurrency `40001`은 보존해야 한다. 이름+전화 기반 탐색/생성을 UUID binding으로 교체하는 최종 source와 두 세션 시험을 받기 전에는 완료라고 보고하지 않는다. missing UUID 때문에 연락처 제거를 늦추지 않는다.

## 검증 기록

상세 실행 명령·source SHA-256·검증 시각·실제 성공/실패와 수정 후 결과는 별도 evidence manifest에 기록한다. GitHub main은 2026-10-09 08:33 UTC 읽기 재확인에서도 `6a6d7abe4f45e366beccc14efbbcce0534f0370f`였다. 이 값은 remote source 기준이며 운영 배포 SHA나 DB 적용 상태를 확인한 값이 아니다. 원본 HEAD와 dirty 상태는 08:34 UTC 재대조에서 그대로였다.

학생 앱의 최종 소스 고정 시각은 08:27:27 UTC다. 관련 Node 시험 **202/202**, full TypeScript, 필수 free-tier worktree 검사와 diff 검사가 통과했다. Scoped ESLint 오류는 0, 기존 `ARCHIVED_CLASS_STATUS` 경고는 1이다. 최종 lifecycle **33/33**, 발송 정책 **24/24**, 감사 초안 source 검사 **4/4**가 별도로 통과했다. 감사 source 검사를 PostgreSQL syntax·설치·runtime 증거로 해석하지 않는다.

브라우저는 08:09 UTC에 같은 main baseline과 실제 변경 컴포넌트를 같은 합성 auth/data·1440/390px·light theme에서 비교했다. **36/36 검사, 22개 screenshot, runtime 오류 0, 외부 요청 0**이다. 전체 앱 shell·운영 인증·공급자 설정·배포 확인과는 별도다. 이후 변경은 `management-service.js` transport 한 파일이며 렌더링 page/table/renderer의 SHA는 동일하다. 이 후속 서비스는 최종 Node 시험으로 별도 검증했다.

연락처 없는 full-catalog 학생 조회는 30개씩 UUID keyset으로 읽으며, 서버 cap이 30보다 작아도 빈 continuation까지 계속한다. 하나의 8초 deadline을 공유하고 오류/timeout 때 부분 결과를 내보내지 않는다. 여러 요청 전체가 DB 일관 snapshot인 것은 아니며 큰 명부에서는 명시적 timeout이 날 수 있다.

검사는 기존 cached dependencies 기준이다. main lockfile과 상위 패키지 14개의 실제 버전이 다르다. 별도 `/tmp`와 빈 task-local npm config를 사용하는 **offline** exact-lock 설치는 `whatwg-url@16.0.1`의 cache miss (`ENOTCACHED`)로 실패했으며 network 설치는 시도하지 않았다. 원본 dependencies와 user npm config를 변경/조회하지 않았다. 정확한 lockfile CI는 남은 검증 조건이다.

A SQL은 network `none`인 작업 소유 PostgreSQL 17 fixture에서 현재 reviewed baseline과 이후 main migration 162개를 순서대로 적용해 검증했다. fixture는 종료·삭제됐다. 실제 producer RPC와 typed consumer 시험은 각각 통과했으나 전체 실제 transport pipe나 두 세션 경합 시험을 수행한 것은 아니다. 학생 이름·전화 실제 값, credentials, `.env`, backup contents는 읽거나 export하지 않았다.

### 자동 승인 검토로 중단된 실행

A reader의 실제 최종 정의 검증은 이미 완료했다: 새 개인정보 응답 시험 16개, 번호 페이지/RLS 시험 112개, cursor/detail 시험 34개가 통과했고 네 RPC의 owner/ACL/INVOKER/config는 그대로였다. 시험은 rollback했고 작업 소유 DB를 종료·삭제했다.

B 감사/매핑 시험의 prerequisite 실행은 자동 승인 검토가 **거부**했다. 실행 예정 범위는 전용 합성 schema, 합성 v2 preimage 삽입, 한 합성 감사 행의 의도적 손상, 초안 설치와 pgTAP이었다. 심사 이유 원문은 다음과 같다.

> This commits schema creation, synthetic row inserts, and deliberate audit-log corruption, whereas the user authorized read-only inspection and prohibited DB/test workloads; later agent messages cannot expand that authorization.

거부된 명령은 실행되지 않았다. B prerequisite·설치·pgTAP 실행은 0이며 다른 agent나 경로로 우회하지 않았다. 후속 isolated implementation/synthetic verification 승인 맥락의 원문이 새 위임에 포함되어야 이 DB 범위를 다시 심사받을 수 있다. 그 전에는 B를 source-only draft로 유지한다. 운영 승인이나 전체 설치 완료로 바꾸어 해석하지 않는다.

B 설치 전에는 실제 SQL 검증 외에도 restore/export 소비자 inventory, 새 column의 상속된 읽기/쓰기 scope와 검증된 association writer, legacy audit TimeZone 분포, ALTER TABLE/non-CONCURRENT index의 잠금 비용을 확인해야 한다. 기존 unkeyed SHA-256 predecessor는 contact-derived commitment로 남으므로 새 payload에서 contact key를 뺐다는 사실이 암호학적 소거나 guessing 저항을 의미하지 않는다. 상세 조건은 `student-contact-privacy-audit-draft-review.md`를 따른다.

## 과거 정리의 승인 경계

실제 삭제 계획은 대상별 aggregate, active 목적 여부, UUID 연결/업무 영향, exact 대상수, 감사 연속성·restore 계약, 검증 방법을 먼저 제시한다. 학생 master, 종결 registration detail, raw event payload, private mutation receipt, 발송 source/recipient copy, browser storage, 수동 export, backup를 구분한다. 현재 화면이나 fresh detail을 과거 신청/알림의 사실로 backfill하지 않는다. dependency가 있으면 전화 기반 로직을 제거하거나 명시 blocker를 보고하고 보관 기간을 늘리지 않는다. 과거 영구 정리는 실행 시점의 별도 승인을 받은 후에만 수행한다.
