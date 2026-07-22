# Supabase 알림 전환 마이그레이션 경계 설계

**작성일:** 2026-07-22
**상태:** 사용자 권장안 실행 승인 완료
**대상 저장소:** TIPS Dashboard 관리자 앱

## 1. 목표

일반 Supabase 스키마 배포와 아직 승인되지 않은 알림 운영 전환을 분리한다. 이후의 정상 마이그레이션은 GitHub Actions의 `supabase db push --linked --include-all`로 계속 배포할 수 있어야 하고, 알림 전환 원본 6개는 관찰 조건과 별도 전환 승인이 충족되기 전에는 어떤 자동 경로에서도 실행되지 않아야 한다.

이번 작업은 알림 전환을 실행하는 작업이 아니다. Google Chat, Web Push, SOLAPI, shadow, worker, watchdog, canonical dispatch와 소유권 전환은 모두 현재 비활성 상태를 유지한다.

완료 상태는 다음을 모두 만족해야 한다.

- `supabase/migrations`에는 일반 배포 가능한 마이그레이션만 존재한다.
- 전환 원본 6개는 바이트를 바꾸지 않은 immutable quarantine으로 보존한다.
- CI가 SQL 파일 목록·순서·SHA-256, pgTAP exact set, drain gate 위치와 자동 배포 경계를 검증한다.
- 일반 DB 배포 CI는 다시 녹색이 된다. quarantine 원본 6개는 적용하지 않되, 독립 보안 점검에서 발견된 `prepare_notification_immediate_delivery_v1` ACL 결함은 정확히 한 개의 새 ACL-only forward migration으로 보정한다.
- 향후 전환에서 `apply_migration` 또는 `execute_sql`로 원본을 직접 적용해 이력 drift를 재발시키는 절차를 금지한다.
- 미래 전환 설계가 현재 과학 알림 보호 함수를 과거 정의로 되돌리지 못하게 명시적으로 차단한다.

## 2. 현재 문제와 확인된 사실

공식 Supabase CLI는 로컬 마이그레이션으로 `supabase/migrations`만 읽고, 원격의 `supabase_migrations.schema_migrations`와 timestamp를 비교한다. `db push --include-all`은 원격 이력에 없는 로컬 파일을 timestamp 순서대로 모두 실행한다.

현재 GitHub Actions는 아래 6개도 일반 배포 후보로 인식한다.

1. `20260716195000_notification_workflow_legacy_closure.sql`
2. `20260716195500_notification_worker_schedule.sql`
3. `20260716195800_notification_registration_provider_claim.sql`
4. `20260716195900_notification_control_plane_forward_compat.sql`
5. `20260716196000_notification_shadow_fixture_runner.sql`
6. `20260717145304_notification_shadow_deterministic_evidence.sql`

첫 파일은 24시간 이상, Asia/Seoul 기준 완결된 운영일, 최대 600초 영수증 간격, 단일 build, 두 고정 경로의 실제 성공을 DB에서 재검산한다. 현재 관찰은 이 조건을 완료하지 않았으므로 `notification_contract_drain_not_complete`로 실패하는 것이 정상이다. 그 결과 이후의 무관한 정상 DB 마이그레이션도 같은 큐에서 막힌다.

운영 DB의 현재 안전 상태도 재확인했다.

- 설정 UI 플래그만 `true`; provider, dispatch, adapter, shadow 플래그 11개는 모두 `false`
- `pg_cron` 확장과 `cron.job` 없음
- 전환 원본 6개는 원격 이력에 없음
- 과학 연결은 disconnected이고 webhook secret 없음
- `public.prepare_notification_immediate_delivery_v1(text,uuid,uuid,uuid,text,text,text,bigint,uuid,bigint,bigint,timestamptz,jsonb)`는 `SECURITY DEFINER` 본문 안에서 `service_role`을 fail-closed로 확인하지만, 운영 ACL에는 `PUBLIC`, `anon`, `authenticated`, `service_role` EXECUTE가 모두 남아 있었다. 이 ACL 결함은 quarantine 이력 정리와 별도로 발견했다.

## 3. 검토한 접근

### 3.1 CI에서 선택적으로 건너뛰기

채택하지 않는다. Supabase CLI에는 특정 timestamp만 제외하는 공식 `db push` 옵션이 없다. CI에서 checkout 파일을 임시 이동하거나 `--include-all`을 제거하면 실행 환경마다 migration view가 달라지고, 의존성 누락과 이력 불일치를 숨긴다.

### 3.2 지금 즉시 install과 activation을 전면 분해

장기적인 최종 구조로는 가장 좋다. schema/function 설치는 일반 migration으로 만들고, bridge closure·cron 설치·flag/owner 전환은 service-role 전용 RPC와 immutable audit로 분리하면 clean replay와 운영 승인 경계를 동시에 만족시킬 수 있다.

그러나 현재 6개는 약 1만 줄의 기존 cutover 패키지이며 install과 activation이 섞여 있다. 이를 지금 재작성해 운영 DB에 설치하는 것은 미완료 관찰과 별도 승인으로 남겨 둔 알림 전환 범위를 확장한다. 특히 최종 SQL은 template checksum trigger를 즉시 바꾸며, 과학 마이그레이션이 이미 보강한 함수와도 순서 충돌이 있다. 이번 정리에서 운영 schema를 바꾸는 방식으로 사용하지 않는다.

### 3.3 Immutable quarantine과 강제 경계

이번 작업의 채택안이다. 6개 원본을 `supabase/pending-migrations/notification-cutover`에 그대로 보관하지만, 이 폴더는 실행 가능한 두 번째 migration system이 아니다. CI가 자동 실행을 금지하는 immutable archive이며 미래 전환 설계의 원본 자료다.

향후 전환을 재개할 때는 install과 activation을 분리한 새 forward-dated migration/RPC를 설계해야 한다. 과거 6개를 Supabase 플러그인으로 직접 실행하거나 그대로 승격하는 것을 기본 절차로 삼지 않는다.

## 4. 저장소 경계

### 4.1 Active lane

`supabase/migrations`만 일반 배포 lane이다. 이 폴더의 파일은 다음을 전제로 한다.

- clean environment에서 timestamp 순서로 재생 가능
- `db push --include-all` 자동 실행 가능
- 미완료 운영 관찰을 기다리며 실패하지 않음
- provider 발송, owner cutover, shadow 시작 같은 별도 운영 승인을 암묵적으로 수행하지 않음

### 4.2 Quarantine lane

`supabase/pending-migrations/notification-cutover`는 다음 파일만 가진다.

- 원본 SQL 6개
- `manifest.json`: 고정 순서와 각 SHA-256
- `README.md`: 비실행 경계, 직접 적용 금지, 향후 재설계 조건
- `tests/`: pending 객체를 전제로 하는 pgTAP 3개

SQL 파일의 이름과 내용은 이동 전과 바이트 단위로 같아야 한다. 추가 SQL, 이름 변경, 순서 변경, 내용 변경은 CI에서 실패한다.

### 4.3 검증기

`scripts/verify-supabase-migration-layout.mjs`는 Node 내장 모듈만 사용하고 다음을 fail-closed로 확인한다.

1. manifest schema와 정확한 6개 ordered entry
2. quarantine 폴더의 SQL 집합이 manifest와 정확히 일치
3. quarantine SQL 6개의 SHA-256 일치와 종속 pgTAP 3개의 exact name·regular-file set 격리
4. outer comment·whitespace·unquoted case·동일한 lowercase quoted identifier·dollar tag만 바꾼 근접 복제도 `sql_lex_v1` lexical SHA-256으로 탐지
5. qualified·unqualified reserved object와 동등한 ordinary/E/dollar/인접 문자열 activation marker는 하나만 나타나도 거부하고, `DO` 및 정확한 `CREATE [OR REPLACE] FUNCTION/PROCEDURE ... AS`의 ordinary/E/dollar 실행 본문과 그 안의 직접 static `EXECUTE` ordinary/E/dollar literal도 marker 검사하며, 각 cutover family의 서로 다른 marker가 2개 이상이면 거부
6. 기존 `claim_notification_deliveries_v1`·`reconcile_notification_delivery_v1` marker는 각각 `20260716112000_notification_control_plane_worker_rpc.sql`의 exact path와 raw SHA-256에서만 허용하며 분할 복사·이름 변경·byte drift는 거부
7. unterminated string·quoted identifier·nested block comment·dollar body와 지원하지 않는 `U&` escape form은 정상화 실패로 active lane을 fail-closed 처리
8. active lane에 같은 파일 또는 `notification_contract_drain_not_complete` 없음
9. drain gate는 첫 원본에만 존재
10. `20260722130000_notification_prepare_acl_hardening.sql`의 파일명과 SHA-256, ACL-only 구문을 고정하고 이 파일만 120000 이후 보호 함수 참조로 허용
11. timestamp의 앞뒤와 무관하게 exact science migration과 exact ACL migration 외의 파일에서 두 보호 함수 이름이 나오면 실패하며, ACL 파일의 누락·변조·이름 변경·함수 생성/교체/삭제·추가 statement도 실패
12. `.github/workflows` 아래의 재귀적 `.yml`·`.yaml` 집합은 `supabase-db-push.yml` 한 파일과 정확히 같고 이 파일의 전체 SHA-256도 일치
13. DB push workflow가 secret 없는 focused boundary test와 검증기를 secret-bearing step 및 push보다 먼저 실행
14. workflow가 quarantine 경로를 복사·이동·직접 실행하지 않고 wrapper·sibling/nested workflow·줄 연속 command로 push 경계를 우회하지 않음

GitHub Actions는 checkout 직후 검증기를 실행하고 기존 `supabase db push --linked --include-all`을 유지한다.

`sql_lex_v1`은 token type과 UTF-8 byte length를 함께 frame하고 `sql_lex_v1\0` prefix를 붙여 hash한다. outer PostgreSQL comment와 공백은 버리되 string literal과 generic dollar body bytes, 대소문자 구분 quoted identifier는 보존한다. `E`·`B`·`X` prefix의 인접성, longest-match operator, 중첩 block comment를 구분하며 dollar delimiter tag만 무시한다. `U&` escape form은 부분 해석하지 않고 fail-closed 처리한다.

이 값은 PostgreSQL 의미 동등성을 증명하는 parser hash가 아니라 comment·case·layout·tag만 바꾼 근접 복사를 잡는 defense-in-depth lexical fingerprint다. 특히 generic dollar body는 유효한 임의 텍스트를 오판하지 않도록 opaque bytes로 취급한다. marker 검사는 이 fingerprint와 별도로 statement-local `DO` 및 정확한 `CREATE [OR REPLACE] FUNCTION/PROCEDURE ... AS`의 ordinary/E/dollar 실행 본문을 다시 tokenize하고, 그 본문 안에서 `EXECUTE` 바로 뒤의 static ordinary/E/dollar literal도 정적 SQL로 검사한다. 일반 `SELECT` string 값과 동적 표현식은 opaque하게 유지한다. raw SHA-256, timestamp, bare reserved identifier, marker family, exact baseline allowlist가 별도 경계이며 이 fingerprint 단독으로 악의적 재작성 전체를 차단한다고 주장하지 않는다. 고정 lexical SHA-256은 다음과 같다.

| quarantine SQL | `sql_lex_v1` lexical SHA-256 |
| --- | --- |
| `20260716195000_notification_workflow_legacy_closure.sql` | `487e14d495cd227017a46876813a00f17ac63b2891ca5c7f307292624341d6b3` |
| `20260716195500_notification_worker_schedule.sql` | `7d5062926dc7cc0f0f5602f58bd717ef2b26e304896b94587feadc4311b7abcd` |
| `20260716195800_notification_registration_provider_claim.sql` | `a47121124beffff10de5a42c1a7935b1abe000890b25ecbfc0dad638e1c33b37` |
| `20260716195900_notification_control_plane_forward_compat.sql` | `35c66056658cc2a6a8e776aff2a20f90f66a06d1ba2b73f6e6b47087e673b76c` |
| `20260716196000_notification_shadow_fixture_runner.sql` | `aa8be81d5fec7b5073979720a0b69a20aa3e1827adfba61e98428e7c58296caa` |
| `20260717145304_notification_shadow_deterministic_evidence.sql` | `593a3d9ab88dab5deb79e33b7eeb3604cf59bec9891c18b5125d73b028e44cda` |

### 4.4 저장소 거버넌스 경계

검증기, focused test, workflow 전체 hash는 실수나 일반적인 우회를 조기에 거부하는 defense-in-depth다. 동일한 변경 권한으로 검증기·테스트·workflow·고정 hash를 함께 바꿀 수 있는 악의적 maintainer까지 막는 완전한 보안 경계는 아니다.

따라서 branch protection, `CODEOWNERS` 기반 필수 보안 리뷰, protected environment 승인, Supabase secret 접근 최소화는 별도의 저장소·배포 거버넌스 경계다. 이번 변경은 이 설정들을 생성하거나 변경하지 않는다. workflow hash를 의도적으로 바꾸는 작업은 별도 boundary-security 검토와 테스트의 독립 상수 동시 갱신을 요구하며, 코드 검증 통과만으로 운영 DB 적용이나 알림 전환 승인을 대신할 수 없다.

## 5. 테스트와 참조 정책

기존 Node 테스트는 원본 SQL의 함수, 권한, 안전 조건을 source contract로 계속 검사한다. 파일이 실행 대상이 아니라는 이유로 테스트를 삭제하지 않고 URL만 quarantine 경로로 바꾼다.

새 경계 테스트는 quarantine SQL의 고정된 이름·순서·SHA-256을 독립적으로 보유하고 pgTAP의 exact name·regular-file set을 별도로 확인한다. manifest와 검증기를 함께 잘못 수정해도 테스트가 원본 drift를 잡아야 한다. deterministic evidence 테스트의 디렉터리 scan도 quarantine lane만 대상으로 한다.

pending 객체를 전제로 하는 아래 pgTAP은 같은 quarantine의 `tests/`로 이동한다.

- `notification_workflow_seed_test.sql`
- `notification_worker_schedule_test.sql`
- `notification_shadow_deterministic_evidence_test.sql`

따라서 일반 `supabase test db`가 미설치 cutover 객체 때문에 실패하지 않는다. 현재 active base도 검증하는 `notification_control_plane_runtime_test.sql`은 일반 test lane에 유지한다. 향후 install/activation 분리 설계에서 quarantine pgTAP을 active schema suite와 operational cutover suite로 다시 분류한다.

## 6. 미래 전환의 필수 재설계 조건

Quarantine 원본은 그대로 직접 실행하면 안 된다. 향후 작업은 적어도 다음을 만족해야 한다.

- schema/function/grant 설치와 bridge closure·flag·owner·schedule activation을 분리
- install migration은 provider 호출, secret 저장, cron job 설치, flag enable, owner canonical 전환, `closed_at` 변경을 모두 0으로 유지
- activation RPC는 service-role only, DB 내부 증거 재검산, 잠금, expected revision CAS, request UUID idempotency와 immutable audit를 사용
- activation은 migration history가 아니라 별도 cutover audit에 기록
- rollback은 down migration이 아니라 기존 rollback RPC를 사용하고 sent/unknown/provider receipt를 보존
- `20260722120000_science_notification_connection.sql`이 보강한 `revalidate_immediate_notification_delivery_v1`과 `prepare_notification_immediate_delivery_v1`을 과거 195500/195900 정의가 덮어쓰지 않음
- 최종 정의는 과학 director, 과학 subject-team, `google_chat.science` 보호를 유지
- `prepare_notification_immediate_delivery_v1`의 함수 본문은 그대로 유지하고 owner는 `postgres`, 명시적 EXECUTE ACL은 owner와 grant option 없는 `service_role`만 유지하며 `PUBLIC`·`anon`·`authenticated`·예상 밖 역할은 실행할 수 없음
- 적용은 정식 forward timestamp를 가진 Git migration과 공식 DB CI만 사용하고, 플러그인의 실행시각 버전 이력을 만들지 않음

이 조건을 만족하는 별도 설계와 승인 전에는 quarantine SQL을 active lane으로 옮기지 않는다.

## 7. 운영·데이터 영향

quarantine 경계 변경 자체와 후속 ACL 보정을 구분한다. 이번 후속 보정에서 의도한 운영 schema/history delta는 정식 CI가 `20260722130000_notification_prepare_acl_hardening.sql` 한 건을 적용해 정확한 함수 owner/ACL만 바꾸고 그 migration version 한 건을 이력에 추가하는 것이다.

- 운영 DB DDL: 위 정확한 함수의 owner/EXECUTE ACL 보정만 있음
- 운영 DB data DML: 없음
- migration history 변경: `20260722130000_notification_prepare_acl_hardening` 한 건만 추가
- 함수 본문·인자·반환형·`SECURITY DEFINER`·빈 search path: 변경 없음
- runtime flag 변경: 없음
- cron/worker/watchdog 설치: 없음
- Google Chat/Web Push/SOLAPI 호출: 없음
- Vercel 앱 동작 변경: 없음

배포 뒤 `supabase migration list`와 `db push`가 active lane 기준으로 동기화되어야 한다. 기대 운영 ACL은 정확한 시그니처에 대해 `service_role EXECUTE=true`, `anon/authenticated EXECUTE=false`, PUBLIC 직접 grant 없음, service-role grant option 없음이다. 데이터, 함수 본문, runtime flag, connection, cron과 provider-zero 상태는 작업 전후 동일해야 한다. 로컬 구현 단계에서는 DB에 직접 적용하지 않고, 공식 DB CI가 migration을 적용한 뒤 실제 post-state를 별도 검증한다.

## 8. 실패 처리

- manifest/hash/layout 검증 실패 시 DB 연결 전에 CI를 중단한다.
- DB dry-run이 새 migration을 제시하면 실제 push 전에 원인을 조사한다.
- 원격 전용 또는 로컬 전용 active migration이 생기면 SQL을 재실행하거나 이력을 임의 수선하지 않고 version/name/hash/schema를 먼저 비교한다.
- 운영 DB에서 `db reset --linked`를 실행하지 않는다.
- provider-zero 또는 schema fingerprint가 달라지면 배포 완료로 보고하지 않는다.

## 9. 완료 검증

- 새 경계 테스트 RED 확인 후 구현으로 GREEN
- 모든 직접 참조 테스트 통과
- 전체 notification/operations 회귀 통과
- TypeScript, ESLint, Webpack production build 통과
- `git diff --check` 통과
- `supabase migration list` active local/remote 정합
- GitHub DB push workflow 성공 및 `Linked project is up to date.` 확인
- 원격 migration history와 함수 ACL은 위 한 건의 기대 delta와 정확히 일치하고, 함수 본문·data·flag·connection·pg_cron·provider-zero 상태는 불변
- Vercel production READY와 주요 route HTTP 200

참고:

- [Supabase db push CLI reference](https://supabase.com/docs/reference/cli/supabase-db-push)
- [Supabase Database Migrations](https://supabase.com/docs/guides/deployment/database-migrations)
