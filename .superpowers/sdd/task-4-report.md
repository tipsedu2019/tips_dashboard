# 작업 4 구현 결과 보고서

상태: 공통 알림 어휘와 순수 설정 계약 구현, 회귀 검증, 독립 검토를 완료했습니다.

구현 커밋: `787cd10` (`test: define notification control plane contracts`)

## 구현 범위

- 업무 7개, 이벤트 79개, 대상 12개, 채널 4개의 닫힌 어휘를 정확한 순서와 값으로 고정했습니다.
- `web_push`는 `in_app`에서 파생되는 채널로만 유지하고 독립 설정 규칙으로 들어오면 거절합니다.
- Supabase RPC가 반환할 snake_case 값을 브라우저용 camelCase DTO로 한 번만 변환하는 실패-폐쇄 decoder를 만들었습니다.
- rule·template·connection의 bigint revision은 JavaScript number로 바꾸지 않고 10진 문자열로 보존합니다.
- draft 생성, dirty 판정, 네 가지 허용 필드만 포함하는 최소 patch, template token·예약 구조·Google Chat 연결 검증, 3-way rebase와 같은 필드 충돌·덮어쓰기 확인을 순수 함수로 구현했습니다.
- React, Supabase client, 외부 발송 provider, 업무별 구현을 import하지 않습니다.
- `package.json`에 `test:notifications` 명령을 추가했습니다.

## TDD와 검토 보강

최초 RED는 새 프로덕션 모듈이 없는 상태에서 실행했고 `ERR_MODULE_NOT_FOUND`로 실패했습니다. 구현 뒤 초기 계약 테스트 12/12가 통과했습니다.

독립 검토에서 다음 경계를 추가로 찾아 각각 회귀 테스트를 먼저 실패시킨 뒤 수정했습니다.

- channel·audience와 맞지 않는 `connection_key` 거절
- 검증 오류가 남은 Google Chat 연결로 신규 규칙 활성화 차단
- 예약 설정의 임의 필드·cron·외부 URL 필드 거절 및 허용 필드만 patch에 포함
- 동적 `subject_team` Chat 규칙은 수학·영어 연결이 모두 정상일 때만 신규 활성화
- 중복 rule·template·connection 식별자 거절
- 같은 개수로 rule ID만 바뀐 draft도 dirty로 판정
- 전체 79개 이벤트와 12개 대상, 4개 채널을 테스트에서 그대로 고정

최종 독립 검토는 P0/P1/P2 잔여 문제 없이 통과했습니다.

## 최종 검증

- 공통 알림 모델 집중 테스트: 18/18 통과
- 기존 전체 회귀 + 작업 4 테스트: 1050/1050 통과
- `pnpm exec tsc --noEmit`: 통과
- 대상 ESLint: 오류·경고 없이 통과
- `git diff --check`: 통과
- `pnpm run test:notifications`: 다음 단계 RED 파일이 생기기 전 12/12 통과. 이후 보강된 최종 모델 파일은 직접 실행으로 18/18 통과
- 다음 작업 5의 의도된 RED 스키마 테스트는 전체 회귀 수치에서 제외했습니다. 작업 5 구현 후 같은 package 명령에 다시 포함합니다.

## 외부 상태와 확인 화면

- Supabase 쓰기, 마이그레이션 적용, 런타임 플래그 변경, 외부 provider 호출, 배포는 수행하지 않았습니다.
- 작업 트리 전용 Next.js 개발 서버는 Webpack 모드로 `http://localhost:3001`에 실행 중입니다.
- `/admin/registration` 응답은 HTTP 200으로 확인했습니다.
