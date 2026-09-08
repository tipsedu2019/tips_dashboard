# 등록 알림 운영 수정과 반영 기록

2026-09-08, Asia/Seoul. 공개 수업 리뉴얼이 반영된 `7b80add7`에서 Q-11/Q-12/Q-13/Q-16만 분리했다. 공개 수업과 랜딩페이지 구현은 변경하지 않는다.

## 변경

- 등록 과목 저장은 화면을 열 때의 과목 목록을 v2 RPC에 전달한다. DB 잠금 뒤 최신 목록과 비교하고 다른 관리자의 변경이 있으면 `23514 / registration_subjects_conflict`로 거부한다. 일반 등록 사실 저장은 독립적으로 유지하며, 같은 요청의 응답 유실 재실행과 과목 이력 보존을 유지한다.
- 영어 단어 재시험은 Google Chat 설정에서 제거한다. legacy route, 공통 provider, 최종 DB 외부 호출 등록 함수가 재시험 발송을 차단한다. DB CHECK가 재활성화를 막으며, 아직 발송을 시작하지 않은 작업만 취소한다. 업무 자체와 과거 발송 이력은 보존한다.
- 상담 신청·상담 완료·대기 신청·등록 신청 알림은 DB가 생산한 양의 정수 버전을 받는다. 발송 직전 원본 사실의 최신 버전 재검증은 유지한다.
- 접수된 알림톡에 `전달 결과 확인`을 추가한다. 로그인한 원장·관리팀의 권한과 저장된 접수 기록을 확인한 뒤 SOLAPI GET 조회만 수행한다. 공급자 ID와 요청 키가 일치하는 `COMPLETE / 4000`만 전달 완료로 표시한다. 조회는 기존 접수 상태, 중복 방지 잠금, 등록 사실을 수정하지 않는다.
- 준비 상태를 한글 조치 문구로 표시하고, worker 오류 원인은 허용된 코드만 보존한다. 접수된 알림톡의 화면 안내도 전달 조회 동작에 맞춘다.

## 운영 사전 관찰

11:31–11:34 KST, 읽기 전용 조회:

- 운영 migration 285개, 최신 `20260905143000`. 아래 4개 migration은 미반영이었다.
- 등록 Chat 규칙 5개 ON, 16개 OFF. ON은 방문상담 예약·변경·교체·과목 제외·취소다. 재시험 10개 규칙은 OFF이고 진행 중인 재시험 Chat 작업은 없다.
- 최근 7일 등록 fanout 오류 4건은 `payload_schema_unsupported`, source revision 2/3/4다. 이번 adapter 오류 재현과 일치한다.
- worker 최근 24시간 started/succeeded 각각 16개, 중지 설정 false, wakeup requested/completed 498, 대기 generation 없음. 보존된 pg_net 응답은 HTTP 200 15개, timeout 1개, 대기 요청 0개다. 최근 7일 외부 발송 시도 등록 0개다.
- 최근 30일 알림톡 3건은 `accepted / 2000 / attempt 1`: 청강 예약, 방문상담 예약, 대기 안내 각 1건. 접수 기록을 실제 전달 완료로 해석하지 않는다.
- 최종 운영 함수는 자동 리마인드 활성화를 `55000 / registration_customer_reminder_automatic_delivery_retired`로 거부한다. 자동 리마인드 OFF는 현재 정책이다.

## 검증

- 전체 알림·등록 Node 회귀 2,133개 중 2,131개 통과. 기존 기준 2개가 9/1 최종 SQL과 달라 실패했다. 하나는 사라진 주석으로 잠금 순서를 찾았고, 다른 하나는 폐지된 자동 리마인드의 과거 22개 검사를 요구했다. 실제 최종 잠금 SQL 및 자동 실행 폐지·ACL·무발송 상태 보존 검사로 고쳤다. 해당 두 파일과 알림톡 dialog 재검사 28/28 통과. 전체를 한 번에 모두 통과했다고 기록하지 않는다.
- 현재 ordered migration을 적용한 격리 DB: 신규 3개 pgTAP, 등록 사실 최종화, 등록 관리 알림, 보관 과목 발송 차단, legacy 중복 방지, 자동 예약 최종 경계의 8개 파일 통과. 별도 두 세션의 과목 동시 수정 probe, DB lint, postdeploy contract 통과. 종료 후 소유한 임시 DB를 정리했다.
- 타입 검사, 변경 파일 lint, production webpack 빌드 통과. 실제 알림 내용 no-send 검사도 통과했다.
- 실제 React 화면의 독립 로컬 fixture를 1280px/390px에서 확인했다. 접수→전달 결과, 조회 중 비활성화, 오류 안내, 닫은 뒤 포커스 복귀, 닫기/재진입 시 이전 조회 무효화를 확인했다. 390px에서 가로 넘침이 없고 fixture의 실제 발송 호출은 0회다. 운영 학생/수신자는 사용하지 않았다.

## 반영 순서와 경계

1. PR CI에서 최종 migration 체인·SQL lint·회귀 검사를 통과시킨다.
2. 검증된 release branch의 기존 DB workflow를 dispatch한다. rollback preflight → DB push → postdeploy receipt를 확인한다.
3. 운영에 다음 migration 4개와 최종 함수·ACL·CHECK가 반영됐는지 읽기 전용으로 검증한다.
   - `20260907092019_registration_subject_snapshot_guard.sql`
   - `20260907101952_retire_word_retest_google_chat.sql`
   - `20260907103333_validate_word_retest_google_chat_retirement.sql`
   - `20260907112516_registration_customer_delivery_lookup.sql`
4. 앱 PR을 main에 반영하고 Vercel Production 및 실제 로그인 화면을 확인한다. 기존 열린 클라이언트는 새로고침 후 v2 과목 보호를 사용한다.

꺼진 알림 규칙 활성화, 과거 실패 일괄 재처리, 실제 고객·교사 메시지 시험 발송은 이 코드 반영에 포함하지 않는다. 재시험 Chat 폐지는 사용자가 명시한 정책이다. 나머지 규칙의 운영 선택과 실제 수신 시험은 별도이며, DB/배포/worker 성공을 수신 완료의 근거로 합치지 않는다.

공식 근거: [Supabase 함수 권한과 search_path](https://supabase.com/docs/guides/database/functions), [SOLAPI 메시지 상태 코드](https://solapi.com/developers/api/msgstatus). `security definer`의 빈 search_path와 제한된 EXECUTE 권한을 유지하며, 공급자 접수와 최종 전달을 구별한다.
