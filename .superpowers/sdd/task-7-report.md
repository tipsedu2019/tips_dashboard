# 작업 7 구현 결과 보고서

상태: 내구성 있는 알림 오케스트레이션·전달 Worker, canonical/legacy 소유권 경계, 개인별 알림함 읽음 처리, Push 준비 상태 경계를 구현하고 로컬 검증을 완료했습니다.

구현 커밋: `1117f85`

## 구현 범위

- 이벤트 기록, 규칙 fan-out, 규칙·대상 재계산, 전달 claim·lease·완료 처리를 각각 멱등한 RPC와 claim token으로 고정했습니다.
- Worker는 업무 구현을 직접 import하지 않고 주입된 adapter만 사용합니다. 업무별 대상 계산·렌더링·링크·발송 직전 재검증이 없거나 잘못되면 다른 규칙을 추측하지 않고 실패-폐쇄합니다.
- 규칙과 대상 재계산은 cursor compare-and-swap, 세대 번호, 안정된 대상 해시를 사용합니다. 중간 규칙이 superseded되어도 다음 규칙을 건너뛰지 않습니다.
- 발송 직전에 source, rule, recipient, runtime flag, claim token, canonical 소유권, begin-send 상태를 다시 확인합니다.
- Google Chat과 Web Push provider는 begin-send가 만든 canonical context만 받고, 브라우저가 작성한 대상·본문·URL을 받지 않습니다. timeout·reset은 `delivery_unknown`으로 남겨 자동 재시도하지 않습니다.
- canonical과 legacy 발송은 같은 규칙 단위 소유권을 경쟁하며, 재시도 승인은 owner generation을 증가시켜 이전 token의 재사용을 막습니다.
- in-app 알림은 원자적으로 투영하고 개인별 receipt로 읽음 상태를 분리했습니다. 관리팀 공유 알림도 사용자마다 독립적으로 읽으며, 회수된 알림은 읽음 처리할 수 없습니다.
- 읽음 처리는 현재 profile 역할 행을 먼저 잠그고 알림 행을 잠근 뒤 수신자·관리팀 권한·회수 상태를 다시 확인합니다.

## Push 안전성

- Push endpoint는 HTTPS, 표준 포트, 고정 허용 호스트만 통과하며 정규화된 URL로 저장합니다. 사설망·임의 호스트·사용자정보·fragment·비표준 포트는 provider 호출 전에 거부합니다.
- 준비 상태 GET은 현재 사용자의 구독 소유권과 서버·브라우저 capability를 닫힌 boolean/code로만 반환합니다.
- 고정 self-test POST는 현재 profile의 현재 endpoint만 받고, 성공·만료·실패 결과를 비밀정보 없이 감사 RPC에 남깁니다. 감사 기록이 실패하면 발송 성공으로 보고하지 않습니다.
- 구독 재연결은 명시적 `rebind` 동작과 인증된 DB RPC를 통해서만 가능하며 다른 사용자의 endpoint·키를 응답에 노출하지 않습니다.
- 서비스워커는 잘못된 Push JSON을 안전한 기본값으로 처리하고 같은 origin의 `/admin` 경로만 엽니다.

## 검증 결과

- Worker 집중 테스트: `22/22` 통과
- 작업 4~7 알림 집중 테스트: `82/82` 통과
- 관리자·업무·휴보강·결재·등록 상담 관련 회귀: `178/178` 통과
- 전체 Node 회귀: `1114/1114` 통과
- TypeScript: 통과
- 전체 ESLint: 통과
- Next.js production build: 통과, 정적 페이지 `75/75` 생성
- `git diff --check`: 통과
- 로컬 `/admin/registration`, `/sw.js`, `/manifest.webmanifest`: HTTP 200
- 인증 없는 Push 준비 상태 GET과 구독 POST: 의도대로 HTTP 401
- 자동 검증 중 실제 Google Chat·Web Push·SOLAPI provider 호출: 0건
- 독립 최종 코드 검토: P0/P1/P2 잔여 문제 없음

## 외부 상태

- Supabase 원격 마이그레이션 적용, 원격 데이터 변경, 런타임 플래그 변경, 실제 self-test·provider 발송, 배포는 수행하지 않았습니다.
- 실제 pgTAP DB 실행은 승인된 local/preview DB에 작업 5~7 마이그레이션을 적용하는 배포 전 검증 단계에 남겼습니다. SQL source 계약과 pgTAP 패킷은 완료했지만 DB에서 실행한 것으로 보고하지 않습니다.
- 작업 트리 전용 개발 서버는 `http://localhost:3001`에서 계속 실행 중입니다.
