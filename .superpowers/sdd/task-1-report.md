# 작업 1 구현 결과 보고서

상태: 구현과 독립 검토 보강을 완료했습니다. 다만 릴리스 A의 최종 승인에는 인증된 실제 브라우저 실행 증거와, 작성된 pgTAP 묶음을 승인된 PostgreSQL 환경에서 실행한 결과가 추가로 필요합니다.

## 브랜치와 커밋 경계

- 작업 트리: `/Users/hyunjun/Documents/Codex/tips_dashboard/.worktrees/operational-safety-notification-completion`
- 브랜치: `codex/operational-safety-notification-completion`
- 구현 기준 커밋: `c76ca3085008a35de554a0f3adcc27454011fd67`
- 작업 1 최초 커밋: `3020a1f` (`fix: make registration intake save canonical`)
- 검토 보강 커밋: `439dfd1` (`fix: harden registration intake retries and verification`)
- 푸시, 배포, 운영 플래그 변경, 원격 마이그레이션 적용, 원격 계정 생성, 외부 발송은 수행하지 않았습니다.

## RED 증거

프로덕션 코드를 바꾸기 전에 다음 5개 파일 집중 테스트를 실행했습니다.

```bash
"$NODE" --experimental-strip-types --test \
  tests/registration-intake-workflow.test.mjs \
  tests/registration-intake-runtime-probe.test.mjs \
  tests/registration-track-service.test.mjs \
  tests/registration-track-schema.test.mjs \
  tests/ops-task-workspace.test.mjs
```

결과: 128개 중 120개 통과, 8개 의도된 실패. 실패 항목은 폐기 대상인 전화 예약·결과지 입력 화면, 잘못된 방문상담 필드 순서, 비원자적 준비 상태 저장, 불완전한 재시도 식별자, 오래된 화면·소스 단언을 정확히 잡았습니다.

## 구현 내용

- `registration-initial-plan-control.tsx`는 과목별 다음 행동을 먼저 보여주고, 필요한 과목에만 상담 책임자를 표시하며, 레벨테스트와 방문상담 두 종류의 예약 일시만 허용합니다. 전화상담 일시와 예약 단계 결과지 URL은 제거했습니다.
- `registration-intake-workflow.ts`는 두 런타임 조합별 저장 행렬, 불명확 상태 차단, 오래된 필드 제거, 정규화, 고정된 지문·요청 키·문의 시각·업무 시도 묶음을 구현했습니다. 시간대가 없는 예약 값은 서울 시간으로 해석해 정확한 ISO 시각으로 변환합니다.
- `registration-intake-runtime-probe.ts`는 잘못된 숫자 버전을 그대로 보존하고, 정확한 버전 1만 준비 상태로 인정합니다. 정확한 함수 없음만 버전 0으로 처리하며, 형식 오류나 무관한 오류는 불명확 상태로 차단합니다.
- `registration-track-service.ts`는 원자적 RPC 호출 직전에 과목 트랙 런타임과 접수 런타임 버전 1을 각각 다시 확인합니다. 누락·오류·형식 불일치·모순 상태에서는 업무 RPC를 호출하지 않습니다.
- `registration-track-fixture-runtime.ts`와 `registration-track-fixtures.ts`는 정확한 런타임 버전, 마지막 원자적 생성 결과, canonical 행 수와 상세, 동일 요청 키 재실행 결과를 보존합니다. 브라우저 검증기는 이를 이용해 저장 안정성과 중복 0건을 확인할 수 있습니다.
- `ops-task-workspace.tsx`는 오래된 등록 후속 필드를 제거하고, 준비 상태에서는 원자적 초기 업무 저장만 사용합니다. 문의 전용 fallback은 안전한 필드만 저장합니다. 업무 저장 재시도와 저장 후 알림 재시도를 분리해, 알림 실패가 등록 생성을 다시 실행하지 못하게 했습니다.
- `20260716100000_registration_intake_runtime_guard.sql`은 공개 wrapper의 서명과 권한을 유지하면서 두 런타임 마커가 정확히 1인지 확인한 뒤 비공개 구현에 위임합니다. 이 마이그레이션은 생성만 했으며 어디에도 적용하지 않았습니다.
- `registration_intake_workflow_runtime_test.sql`은 과목·접수 마커의 잘못된 버전, 누락, 권한 거부를 각각 검사하고 생성 행이 0개임을 단언합니다.
- fixture 디버그 경계와 브라우저 검증기는 영어 바로 전화상담·수학 방문상담 혼합 저장, canonical 행 조회, 동일 요청 키 재실행, 재열기, canonical 예약·결과·담당자 수정과 새로고침, 데스크톱·모바일 뷰포트를 모두 다룹니다. Google Chat과 즉시 방문 알림 요청이 발생하면 즉시 실패하도록 차단했습니다.

## GREEN 증거

작업 1 집중 검증 명령:

```bash
"$NODE" --experimental-strip-types --test \
  tests/registration-intake-workflow.test.mjs \
  tests/registration-intake-runtime-probe.test.mjs \
  tests/registration-track-service.test.mjs \
  tests/registration-track-schema.test.mjs \
  tests/registration-track-fixtures.test.mjs \
  tests/ops-task-workspace.test.mjs \
  tests/registration-track-workspace.test.mjs \
  tests/registration-workflow.test.mjs \
  tests/registration-consultation-notification.test.mjs
```

최초 결과는 341/341 통과였습니다. 독립 검토 뒤 `tests/registration-browser-verifier-contract.test.mjs`를 추가해 다시 실행한 최종 결과는 351/351 통과였습니다.

필수 로컬 게이트:

- 전체 Node 테스트: 1032/1032 통과
- `pnpm exec tsc --noEmit`: 통과
- `pnpm run lint`: 오류·경고 없이 통과
- `pnpm run build`: 통과, 정적 페이지 72개 생성 및 등록/API 경로 컴파일 확인
- `node --check scripts/verify-ops-task-browser-workflow.mjs`: 통과
- `git diff --check`: 통과
- 정적 마이그레이션·스키마 계약: 전체 Node 테스트 안에서 통과

## 브라우저·데이터베이스 실행 증거

- 결정론적 경로: `http://127.0.0.1:3001/admin/registration?fixture=registration-subject-tracks&fixtureRole=english_admin`
- 작업 트리 서버는 해당 경로에 HTTP 200으로 응답했습니다. 검증기 소스는 데스크톱 1349x987, 모바일 390x844를 고정합니다.
- 실제 시도 명령:

```bash
OPS_BROWSER_WORKFLOW=1 \
OPS_BROWSER_BASE_URL=http://127.0.0.1:3001 \
OPS_BROWSER_ROUTE_FILTER=registration-subject-track-fixture \
OPS_BROWSER_SUPABASE_STORAGE=0 \
node scripts/verify-ops-task-browser-workflow.mjs
```

- 인증 저장 상태, 임시 사용자 생성 권한, 로그인 정보가 없어 브라우저 조작 전에 중단됐습니다. 로컬에는 Playwright 패키지도 없습니다. 원격 임시 사용자나 의존성은 만들지 않았습니다.
- 검증기 자체에는 전체 저장·재열기·동일 요청 재실행·canonical 수정·새로고침·외부 발송 0건 단언이 들어 있고 소스 계약은 테스트로 통과했습니다. 실제 클릭과 브라우저·서버 발송 원장은 아직 실행 증거가 없습니다.
- pgTAP 파일은 작성했지만 승인된 로컬 또는 미리보기 PostgreSQL 환경이 없어 실행하지 않았습니다. 원격 DB로 대신 실행하지 않았고 마이그레이션도 적용하지 않았습니다.

## 검토에서 보강한 사항과 남은 릴리스 증거

- KST 예약 값이 DB·세션 시간대에 좌우되지 않도록 수정했습니다.
- 불명확 재시도가 writer·런타임·요청 키를 바꾸지 못하도록 고정했습니다.
- 레거시 생성 결과가 불명확할 때 두 번째 insert를 거절합니다.
- 과목이 전화·방문 경로에서 빠질 때 숨은 상담 책임자 수동 지정도 제거합니다.
- 저장 후 알림 재시도는 실패한 수신자만 대상으로 하며 업무 생성을 반복하지 않습니다.
- 브라우저 검증기는 저장·재열기·재실행·수정·새로고침 전 과정을 수행하고 두 외부 발송 경로 중 하나라도 호출되면 실패합니다.
- 실행 중 새로운 알림 실패가 추가돼도 기존 재시도 완료가 그 실패를 지우지 못하게 했습니다.
- 사용자가 바뀌거나 화면이 해제되면 재시도 상태를 무효화하고, 이전 사용자의 늦은 결과가 새 사용자 화면에 들어오지 못하게 했습니다.
- 릴리스 A 최종 승인 전에는 인증된 브라우저로 두 뷰포트의 저장·새로고침·동일 요청 재실행·canonical 수정과 외부 발송 0건을 확인해야 합니다.
- 여섯 pgTAP 장애 사례도 승인된 로컬 또는 미리보기 DB에서 통과해야 합니다. 그 전까지 forward 마이그레이션은 적용하지 않습니다.
