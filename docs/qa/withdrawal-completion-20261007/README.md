퇴원 완료에서 비용 확인과 현재 명단 존재 여부를 분리했다. 명단에 남아 있으면 마지막 수업일 당일까지 유지하고 이후 제외한다. 이미 양방향 명단에서 제외되었고 활성 claim이 없으면 다시 추가하지 않고 완료한다. 완료 후 비용 확인 두 항목은 관리자·직원이 별도로 기록하며 금액·미수금·결제 이력은 변경하지 않는다.

기준은 PR113 main `69e978b2`에서 시작해 PR114 main `58cefbf4761ede0d3b7f4cf588e2a4daea05b458`로 정렬했다. PR114는 교재 조회 최적화이며 이번에 검증한 퇴원 제품·테스트 파일은 rebase 전후 바이트가 같다. 이전 미배포 후보 `67513a95`의 날짜 경계 구현을 사용자의 통합 선택에 따라 포함했다. 기존 dirty checkout과 다른 작업 branch는 수정하지 않았다. 열린 PR 조회에서도 별도의 퇴원 후보 PR은 없었다.

현재 main은 명단 연결과 MakeEdu·수업료·교재비 확인을 완료 조건으로 사용하며, 완료 시 날짜를 기다리지 않고 제거한다. 새 코드는 MakeEdu 확인과 정확한 학생/수업 ID 검증을 유지한다. 비용 미확인은 완료를 막지 않는다. 양쪽 명단 불일치, 남아 있는 활성 claim과 빈 명단의 충돌, 대기 관계, 재등록 충돌 등은 계속 거부한다. 기존 수동 명단 gateway의 활성 claim 제한까지 완화한 변경은 아니다.

Chat 문구는 `[일정] 퇴원기준일(마지막 수업일): 날짜 · 회차`다. 이미 제외된 요청이나 과거 기준일의 완료에도 미래 제외를 약속하지 않는다. 문구만 적용하는 검토안은 80000 SQL·renderer 테스트·해당 SQL의 forward manifest 항목 3개 파일이며, 통합 후보의 학생 명단/예약/비용 RPC 변경과 독립적이다. 문구와 실제 제외 경계의 계약은 [운영 문서](../../operations/withdrawal-last-lesson-boundary.md)에 기록했다.

| 검증 | 실제 결과 |
| --- | --- |
| 격리 Linux Node 22.23.2 | 관련 앱·화면 계약 358/358 + 캐시·등록 경계 39/39, 실패·스킵 0 |
| 격리 Linux PostgreSQL 17.11 | 새 완료 pgTAP 96/96 + 기존 예약/날짜 경계 122/122 |
| 실제 두 연결 동시성 | 완료 identity/parent 변경 2/2: `40001`; 비용 체크 경합 1/1: `23514` |
| 최종 guard / 외부 발송 격리 | 4/4 + 6/6 |
| 중립 문구 실제 SQL·스냅샷 | 52/52, 시스템 6개 템플릿 정상 새 버전·재적용 no-op |
| TypeScript / ESLint | `tsc --noEmit` 통과, 변경 파일 lint 오류 0·기존 service 미사용 함수 경고 3 |
| 정적 경계 | migration layout·domain SQLSTATE·diff whitespace 통과, 151개 forward migration SHA 확인 |
| 실제 로컬 route 화면 | 관리자/교사 × 1440px/390px, 합성 완료 목록. 같은 데이터·테마·viewport의 변경 전과 비교 |

새 SQL 테스트는 네 가지 비용 체크 조합, 과거/미래 기준일, 이미 제외된 명단, 이미 퇴원 상태, 시간표 체크가 먼저 된 요청, 정확한 UUID와 동명이인 분리, 같은 transaction의 제거·재등록, 권한, 중복 영수증, 금액 보존을 검증한다. 완료 후 비용 체크로 canonical notification source/fanout이 증가하지 않는 것도 확인했다. 완료 자체는 기존 알림 producer를 유지한다.

SQL 실행은 network-none·host port 0·Unix socket 전용 Docker fixture에서 수행했다. ordered migration의 관련 최종 helper·표·활성 trigger를 가져왔으며 업무 함수를 mock하지 않았다. Auth/JWT와 cron 메타데이터는 합성 인프라다. provider wake-up 함수/HTTP 확장/실제 cron tick은 제외했다. 따라서 전체 Supabase migration·RLS·ACL·trigger chain 재현이나 운영 cron 동작 검증으로 확대하지 않는다. 전용 container와 socket volume은 제거하고 PID 0·부재를 확인했다.

화면 검증은 실제 `/admin/withdrawal` route와 공통 컴포넌트를 사용하되 모든 backend 읽기를 합성 transport로 처리했다. 관리자 완료 행은 비용 두 칩만 버튼이고 MakeEdu는 읽기 전용이다. 교사는 비용 칩도 읽기 전용이다. 일반 완료 업무 편집은 열지 않았다. 같은 표시와 크기를 유지하고 DOM의 허용된 동작만 바뀌었다. 최종 모바일 두 이미지는 바이트가 같고, 데스크톱 두 이미지는 각각 1픽셀 차이였다. [데스크톱](admin-1440.png)과 [모바일](admin-390.png)은 합성 자료다. 실제 저장→DB→provider 통합 E2E나 운영 로그인/학생 완료 검증은 아니다.

독립 검토에서 남아 있던 UI 명단 blocker, 미래 요청의 기존 시간표 체크 조건, 동일 timestamp 제거·재등록 경계, SQL anchor의 과거 SQLSTATE 정적 검사, 두 충돌 메시지의 사용자 안내를 발견해 수정했다. 독립 재검토 및 실제 관련 회귀가 통과했다.

재현은 `verification.json`의 source SHA와 `sql-source-manifest.json`을 먼저 대조한다. 제품 pgTAP은 `supabase/tests/withdrawal_completion_without_settlement_test.sql`과 `withdrawal_last_lesson_release_test.sql`이며 이 폴더의 TAP을 실제 실행 결과로 보존했다. `wording-results.json`은 별도 DB에서 실제 helper를 실행한 52개 assertion이다. Linux Node 검증은 `--test --test-concurrency=1 --experimental-strip-types`, `TZ=Asia/Seoul`로 실행했다. 로컬 전체 fixture 생성/정리 스크립트·함수 정의·실패 시도·로그는 별도 검증 bundle에 보존했다.

첫 병렬 Node 실행은 2GB 제한에서 종료됐으며 직렬 실행으로 완료했다. 기존 단어 재시험 날짜 테스트는 UTC에서 실패해 현재 앱의 서울 시간대를 명시했다. 해당 제품/테스트 파일은 main과 동일하고 UTC 동작 문제는 이번 퇴원 변경에서 수정하지 않았다. 삭제된 클라이언트 퇴원 fallback을 호출하던 오래된 테스트는 실제 SQL의 다른 명단 보존 테스트로 대체했다. 첫 화면 실행은 macOS Node의 native-module 서명 오류였으며 기존 캐시 Node 24.19로 정상 실행했다. 실패 결과를 최종 통과로 세지 않았다.

배포·운영 SQL 설치·scheduler 활성화·실제 학생 완료/변경·알림 발송/재발송은 수행하지 않았다. 선택된 두 실제 요청의 제한된 읽기에서 확인한 기존 blocker와 합성 재현을 구분하며, 실제 완료 성공은 주장하지 않는다. 앱은 새 capability가 없으면 완료/비용 확인을 거부한다. 명단이 남은 당일·미래 요청에는 별도 승인된 scheduler 준비가 필요하다. 현재 DB 장애, 다른 릴리스와 설치 순서는 별도 조율 대상이다. 이 PR branch의 Vercel 자동 배포는 껐고 GitHub Actions 실행도 요청하지 않았다. 전체 production build·전체 native migration replay·운영 적용 후 검증은 미수행이다.

사용자 첨부 JPEG는 Library materialization 지원 경로에서 기본 Python 3.9 타입 오류 후 허용된 Python 3.12 1회 재시도도 `library file transfer failed: download failed`로 종료됐다. helper가 세부 원인을 반환하지 않았으며 소비자 Mac 파일을 확보하지 못했다. 원본 이미지 픽셀은 미확인이다. 위 화면 이미지와 알림 renderer/SQL 검증은 이 원본 이미지 확인을 대신한다고 주장하지 않는다.
