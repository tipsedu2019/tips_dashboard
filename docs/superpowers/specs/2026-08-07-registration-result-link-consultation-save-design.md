# 등록 결과 링크·상담 저장 복구 설계

## 1. 목표

등록 상세의 레벨테스트 결과 URL을 긴 원문을 복사하지 않고 바로 열 수 있게 하고, 전화상담 `상담 정보 저장`이 한국어 알림 변수와 충돌해 실패하는 문제를 복구한다.

## 2. 확인된 원인

운영 화면에서 전화상담 저장을 재현했을 때 `registration_notification_template_allowlist_invalid`가 반환됐다. 상담 저장 RPC는 전화상담 행과 등록 이벤트·내부 알림 투영을 한 트랜잭션에서 만들며, 알림 투영이 실패하면 상담 저장도 롤백된다.

활성 템플릿의 변수 계약은 `{ key: "student_name", token: "학생" }`처럼 한국어 표시 토큰을 사용한다. 반면 등록 전용 legacy renderer는 `token`을 영문 내부 키 정규식으로 검사하고 payload도 `token`으로 조회한다. 따라서 한국어 토큰을 거부하며, 검사만 완화해도 실제 값은 영문 `key` 아래에 있어 빈 문자열이 된다.

## 3. 승인된 접근

### 3.1 결과 링크

- 기존 URL 입력과 저장 동작은 유지한다.
- 현재 입력값이 절대 `http:` 또는 `https:` URL일 때만 `결과 열기` 링크를 표시한다.
- 새 탭에서 열고 `rel="noopener noreferrer"`를 사용한다.
- 긴 URL 원문은 버튼에 노출하지 않고 과목별 접근성 이름을 제공한다.
- `javascript:`, 상대 경로, 잘못된 URL은 링크로 만들지 않는다.

### 3.2 상담 저장

- `dashboard_private.registration_render_fixed_template_v2`의 공개 시그니처와 호출부를 유지한다.
- 허용 변수의 `key`는 영문 내부 payload 키로, `token`은 한국어 편집·표시 토큰으로 분리한다.
- 템플릿은 `{한국어토큰}`과 과거 `{internal_key}`를 모두 허용한다.
- 값은 항상 `p_payload -> key`에서 읽고 두 표기를 같은 값으로 치환한다.
- 알 수 없는 변수, 중괄호가 포함된 토큰, 중복되거나 모호한 변수 계약은 계속 fail closed 한다.

이 변경은 알림 템플릿 내용, dispatch 플래그, worker, Google Chat webhook, SOLAPI 설정을 변경하지 않는다. 과거 이벤트 backfill이나 실제 provider 호출도 하지 않는다.

## 4. 테스트와 릴리스

1. URL 정규화 단위 테스트: `http/https` 허용, 상대·스크립트·오입력 차단
2. 레벨테스트 결과 영역이 안전한 링크를 사용하는 UI 계약 테스트
3. DB renderer 회귀 테스트: 한국어 토큰을 영문 payload key 값으로 렌더링, legacy 영문 토큰 호환, 미상 토큰 차단
4. 전화상담 service 테스트와 등록 알림 집중 테스트
5. TypeScript, ESLint, `next build --webpack`
6. 운영 DB migration 적용 후 동일 task/track에서 전화상담 저장 성공과 persisted consultation 확인
7. Vercel Production READY 후 결과 링크 새 탭 이동과 상담 저장 버튼의 `저장됨` 상태 확인

