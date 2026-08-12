# 공용 알림 워커 운영 스케줄 설계

## 목표

현재 운영 DB에 설치되지 않은 공용 알림 워커 실행 경계를 최신 schema 기준의 새 forward migration으로 설치한다. Google Chat 및 SOLAPI 관찰 알림 규칙은 설치 중 계속 OFF로 유지하며, 1분 worker와 1분 watchdog의 정상 heartbeat를 먼저 확인한 뒤 별도 제어면에서 한 규칙씩 활성화한다.

## 선택한 방식

Supabase `pg_cron`과 `pg_net`을 사용한다. Vercel Hobby 팀은 1분 Cron 배포를 허용하지 않으며, 수동 호출은 작업 종료 뒤 지속되지 않는다. 과거 `supabase/pending-migrations/notification-cutover` SQL은 현재 과학 인지 함수와 런타임 경계를 덮어쓸 수 있으므로 읽기 전용 참고로만 두고 복사·이동·실행하지 않는다.

## 설치 경계

- 새 forward migration 하나만 active lane에 추가한다.
- 중단 래치와 watchdog heartbeat 테이블, worker 실행 허용 RPC, Vault 입력 검증, worker 호출 함수, watchdog 함수, inspect/manage RPC만 설치한다.
- `public.manage_notification_worker_schedule_v1(text,uuid)`만 service role이 실행한다. `inspect`, `install`, `disable`, `remove` 네 동작 외에는 거부한다.
- `install`은 Vault의 정확한 worker URL과 32바이트 이상 bearer secret이 검증된 경우에만 worker/watchdog cron을 각각 하나 설치한다.
- worker 경로는 `POST /api/notifications/worker`이고 Authorization bearer를 사용한다. URL과 secret은 코드·migration·보고서에 기록하지 않는다.
- cron worker는 기존 API의 runtime gate와 기존 production worker 구현만 호출한다. provider를 직접 호출하지 않는다.
- watchdog는 최신 worker heartbeat가 3분보다 오래되거나 실패 상태이면 건강하지 않은 heartbeat를 기록한다. 규칙을 자동으로 켜거나 provider 상태를 바꾸지 않는다.
- 설치 전후 여덟 observation destination rule의 enabled 값과 provider attempt 수가 동일해야 한다.

## 오류 처리와 롤백

- dependency, ACL, Vault, 기존 중복 cron, 비정상 URL/secret이 하나라도 있으면 install 전체가 실패한다.
- inspect는 비밀값 없이 job 수, active 여부, schedule, 최근 worker/watchdog 시각만 반환한다.
- worker 호출 오류는 다음 cron 재시도 대상으로 남기되 개별 provider 전송 소유권은 기존 worker의 unknown/no-retry 계약을 따른다.
- 운영 이상 시 영향을 받는 observation rule부터 OFF로 만들고, 필요하면 schedule `disable`로 두 cron만 비활성화한다. 기존 전송·감사 행은 삭제하지 않는다.

## 검증

- Node source test가 과거 quarantine 복사, 직접 rule/flag 변경, secret literal, provider URL을 금지한다.
- pgTAP이 ACL, exact schedule, Vault 실패, idempotent install/inspect/disable/remove, stop latch, worker/watchdog heartbeat를 검증한다.
- isolated local DB는 runtime 0/provider 0에서 migration과 pgTAP을 실행한다.
- 운영에서는 rules OFF 상태로 migration 적용, Vault/Vercel secret 설정, schedule install, 최신 succeeded heartbeat와 observation count key를 확인한 뒤에만 rule activation으로 이동한다.

## 범위 밖


- Google Workspace Directory 자격증명 생성과 profile identity 동기화
- Google Chat rule 활성화와 실제 방 수신
- SOLAPI 템플릿 승인·환경변수·실수신
- 과거 quarantine SQL 승격 또는 기존 applied migration 수정
