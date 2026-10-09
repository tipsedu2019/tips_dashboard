# API 설정 통합

별도 AI 요청 작성·Chat 운영 UI를 종료하고, 기존 업무 API의 지원 범위·연결 키·결과 확인 안내를 환경 설정의 API 화면에 모은다. 개인별 에이전트 운영, Google Chat 대화 처리, MakeEdu 자동화는 이 변경의 제품 범위가 아니다.

## 유지 및 변경

- 업무 API `/api/v1/*`, `/api/v2/*`, 기존 관리자 발급 연결 키와 허용 범위, 미리보기·멱등 제출·영수증·검증값 계약을 유지한다.
- `/admin/settings/agent-access`의 관리자/명시적 역할 검증 경계를 그대로 유지한다. 개인별 발급이나 실제 권한 확대는 구현하지 않는다. 지원표에 그 한계를 표시한다.
- 별도 AI 메뉴를 sidebar/빠른 이동의 공용 navigation에서 제거한다. 설정 명칭은 API로 변경한다.
- 알림에 이미 기록된 `/admin/ai-agent/{id}`를 보존한다. 요청 목록·상세·작업 journal은 기존 actor ACL 아래 읽기 전용으로 남긴다. 생성·취소·재개·답변·중앙/개인 요청 키 발급·공간 정책 UI를 제거한다.
- 기존 business key 화면을 통합 탭에 유지한다. 계정별 key로 동기 분리하고 actor 초기화를 passive read보다 먼저 수행하여 빠른 inventory 응답이 초기화에 지워지는 경합을 막는다.
- 요청 목록 hook은 StrictMode effect 재시작마다 조회 컨트롤러를 새로 소유하여 폐기된 컨트롤러 재사용으로 무한 로딩되던 문제를 수정한다. 원래 API/서비스/복구 로직, auth-provider, AuthGuard, migrations, RLS/ACL, notification code는 변경하지 않는다. 요청 완료 상태를 업무 반영 영수증으로 표시하지 않는다.

## 제거와 검증 전환

삭제한 UI 4개: `ai-agent-request-create-dialog.tsx`, `ai-agent-credential-issue-dialog.tsx`, `ai-agent-personal-credential-workspace.tsx`, `ai-agent-space-policy-settings.tsx`.

삭제한 브라우저 도구 4개는 폐지된 발급·Chat UI만 검증하던 도구다. `scripts/qa/ai-agent-requests-browser.mjs`를 API 설정/읽기 이력 검사로 교체하고 해당 fixture의 mutation 응답도 제거한다. 기존 실행 안내는 역사 자료로 표시한다. required suite 파일명은 유지하며 삭제 UI 테스트를 현재 역할 경계·정확한 지원 범위·읽기 이력·쓰기 0 검증으로 대체한다. backend authorization/idempotency/service/receipt 회귀는 유지한다.

기준 화면은 학교 설정, 공유 컴포넌트는 SettingsWorkspaceShell/SettingsMasterHeader/SettingsTableFrame/WorkspaceTabs다. 1440px/390px와 light/dark, 키보드 수동 탭 활성화, 로딩·빈 목록·오류 복구, 긴 이력의 전체 페이지 수집 및 계정 교체를 검증한다.

## 병행 작업 및 운영 보존

기준 main: `5a64e153d87c8449b62829ebe0bfdce47600ce0a` (PR129). 진단 후보 `cfb7e6fd3a55dc4876f411d355472873571e0130`는 별도 branch에 그대로 보존하며 이 변경에 포함하지 않는다.

개인정보 후보 `589a0dca555131eb05b43dfb1b953d119cc39dec`의 제공 증분(ed593f4d→589a0dca) 및 등록 이력 후보 `0d766803efdba5540166050c6af70695652fd789`의 파일과 이번 UI 변경 파일은 겹치지 않는다. 개인정보 packet을 main 기준 전체 patch로 취급하지 않았으며 다른 담당 worktree는 수정하지 않는다. merge 직전 실제 main과 다시 대조한다.

운영 DB/키/권한/설정은 이번 UI 정리에 포함되지 않는다. 특히 아래를 자동 삭제·회수하거나 꺼졌다고 추정하지 않는다.

- `dashboard_private.ai_agent_credentials`, `ai_agent_credential_grants`, `chat_credential_space_grants`의 기존 키·grant. 업무 연결 키와 동일 prefix일 수 있으나 다른 audience다.
- `dashboard_private.ai_agent_requests`, messages/events/claims/receipts/actions 및 action events의 원문·이력·멱등 영수증.
- `dashboard_private.chat_space_configuration`, `chat_delivery_outbox`, `chat_delivery_attempts`, send budget, AI Chat support/configuration receipts, space policy 및 personal credential 관련 객체.
- `TIPS_AI_CHAT_SPACE_*` 환경 변수와 Chat support gate. UI 제거는 backend 비활성화나 webhook 삭제가 아니다.
- 업무 완료 자동 알림의 `features/notifications`, `/api/google-chat`, `public.google_chat_webhook_settings`, `GOOGLE_CHAT_WEBHOOK_*` 및 기존 소비자.

향후 운영 정리에는 정확한 credential/grant ID, 활성 소비자, pending/unknown outbox, 원문 보관/이력 정책, 철회 영향과 복구 방식을 읽기 확인한 별도 승인 목록이 필요하다. 현재 데이터 삭제·키 폐기·신규 발급·provider 호출은 0이다.

## 배포와 복구

SQL 변경이 없으므로 기존 동일 SQL 기준의 canonical 실행을 반복하지 않는다. 변경 파일/SQL diff가 0임을 기록하고 적용 가능한 격리 Linux 계약 검사·빌드·타입·린트, 합성 브라우저 및 정확 소스 독립 검토로 확인한다. 유료 Actions 추가 사용·보호 설정 변경·체크 위조를 하지 않는다.

정상 PR merge 자동 배포 후 공개 contract-version의 source hash를 확인하고 실제 로그인 화면을 저장 없이 확인해야 운영 완료다. 앱 rollback은 이 PR revert로 수행할 수 있지만 기존 DB 권한/키는 남는다. 이 변경은 그것들을 철회하지 않는다.
