# 등록 교재 다중 선택 검증

- 기준: `6f354aae` / `codex/registration-multiple-textbooks-20260922`.
- 상태: 로컬 구현·검증 완료. 이 기능의 PR, 운영 DB 적용, 운영 앱 배포는 아직 수행하지 않았다.
- 등록 화면의 기존 수업·일정 입력을 기준으로 shared Button, Popover, Checkbox, Label을 사용했다. 글로벌 디자인 규칙은 변경하지 않았다.

## 동작

반에 연결된 교재를 체크박스로 여러 개 선택하고 전체 해제할 수 있다. 반 변경 시 기존 기본값 정책대로 첫 번째 연결 교재를 선택한다. 저장, 재조회, 목록, 이력, 입학 안내 미리보기에서 전체 선택을 유지한다.

`textbook_ids`가 없는 기존 자료는 `textbook_id` 한 권으로 읽는다. 명시적인 빈 배열은 미선택이다. 첫 번째 교재는 기존 scalar 값에도 남겨 구버전 소비자와 호환한다. 입학 후 정정은 기존 별도 조정 경계를 유지한다. 선택 교재는 모두 반 연결을 검증하며, 참조 중인 두 번째 이후 교재도 삭제를 차단한다. 이전 단일 교재 요청 영수증의 재시도를 보존한다.

## 검증 증거

- Node: registration-track model/service/workspace/fixtures/history, automatic-history UI 테스트 통과. 저장 실패 시 초안 유지, 선택 해제 후 기본값 재설정 방지, 읽기 전용 포함.
- 공통 control/contrast/table 계약과 migration-layout 테스트 통과. TypeScript, 변경 파일 ESLint, `git diff --check`, migration-layout 및 domain-SQLSTATE verifier 통과.
- 격리 DB: 전체 ordered migration 적용 후 `registration_multiple_textbooks_test.sql` 33개, 기존 admission checklist 및 flat-fact finalization 회귀 통과. SQLSTATE 22023/23514/23503/42501, 기존 요청 재시도, 모든 교재 검증, 입학 완료 및 정정 분리, 알림 생성 없음 포함. 마지막 실행 request ID: `registration-multi-textbooks-final`.
- Chrome 로컬 `/admin/registration?fixture=registration-subject-tracks&fixtureRole=english_admin`: 두 권 선택→저장→목록의 두 교재명→상세 재열기 시 두 체크 유지→전체 해제 저장 후 두 체크 해제 확인. Esc 후 trigger 포커스 복원 확인.
- 기존 등록 상세와 같은 다크 테마, 1440×1000 및 390×844 화면에서 공유 입력과의 정렬을 확인했다. 모바일 document width 390px, 교재 팝오버 x=54/right=321로 가로 넘침 없음.
- 브라우저는 합성 fixture, DB는 로컬 격리 환경을 사용했다. 운영 학생 기록 변경 및 실제 알림 발송은 하지 않았다.

## 운영 반영 순서

`20260922105632_registration_multiple_textbooks.sql`을 먼저 적용한 뒤 앱을 배포한다. 앱이 새 컬럼을 조회하므로 순서를 뒤집지 않는다. 기존 scalar 데이터는 backfill하지 않는다. 기존 이력과 선택 배열을 보존하기 위해 앱 rollback 시에도 새 컬럼을 삭제하지 않는다. 운영 적용 후 migration ledger, 배포 SHA, 등록 상세의 읽기 동작을 각각 확인한다.
