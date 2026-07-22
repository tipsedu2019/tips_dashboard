# Supabase 마이그레이션 이력 정합성 복구 기록

## 결과

2026-07-22 운영 Supabase의 원격 전용 마이그레이션 이력 6개를 Git `main`의 정식 마이그레이션 버전으로 재매핑했다. 애플리케이션 스키마, 운영 데이터, RLS/RPC, 알림 설정 및 provider 상태는 변경하지 않았다.

## 원인

과학 기능을 운영 DB에 직접 적용할 때 `apply_migration`이 실행 시각을 버전으로 기록했다. 이후 같은 SQL이 정식 타임스탬프 파일로 Git에 커밋되어, 원격 이력과 `supabase/migrations`의 버전만 달라졌다.

원격 이력의 이름과 저장 SQL MD5를 정식 파일과 비교했으며 6개 모두 바이트 단위로 일치했다.

| 기존 원격 버전 | 정식 버전 | 이름 | SQL MD5 |
| --- | --- | --- | --- |
| `20260722033044` | `20260722090000` | `academic_subject_foundation` | `7e0bb9e9921aa4381e2ddf2ce4923727` |
| `20260722033050` | `20260722093000` | `science_team_and_classroom` | `9b66bfadfa9d1b1807071a9cd40d8693` |
| `20260722033212` | `20260720113000` | `registration_level_test_place_boundaries` | `83363698f71468cb133c044691cee719` |
| `20260722033223` | `20260722100000` | `registration_science_subject` | `fcfe99920395f1699fbc3cba43bf5eab` |
| `20260722033232` | `20260722110000` | `science_classes_and_textbooks` | `3ceb2dc31a615e26d592ca0e1e304e39` |
| `20260722033327` | `20260722120000` | `science_notification_connection` | `d6c2071080bbc38d9bab8c53f68e40c2` |

`registration_level_test_place_boundaries`가 포함된 이유는 최초 과학 등록 SQL 적용이 해당 선행 함수 부재로 실패하여, 선행 파일을 직접 적용한 뒤 재시도했기 때문이다.

## 복구 방식

정식 SQL은 재실행하지 않았다. `supabase_migrations.schema_migrations.version`만 단일 트랜잭션에서 갱신했다.

- 5초 lock timeout과 30초 statement timeout을 설정했다.
- 원본 버전, 이름, SQL MD5가 모두 일치하는지 검사했다.
- 정식 버전과 충돌하는 기존 행이 0개인지 검사했다.
- 마이그레이션 writer와 충돌하지 않도록 이력표를 잠갔다.
- 6개 행의 `version`만 갱신했다.
- 수정 행 수가 정확히 6개인지 검사했다.
- commit 전에 정식 버전, 이름, SQL MD5가 모두 일치하는지 다시 검사했다.
- 동일 절차를 먼저 `ROLLBACK`으로 실행해 원상태가 유지되는 것을 확인한 뒤 실제 commit을 수행했다.

## 사후 검증

- 기존 원격 전용 버전: 0개
- 정식 버전: 6개, 이름과 SQL MD5 모두 일치
- 과학 관련 스키마·함수·제약·정책 지문: 작업 전후 동일
- 과목 설정·과학 세부과목·`별관 4강` 지문: 작업 전후 동일
- 등록 runtime marker 4종: 모두 `1`
- 과학 Google Chat: 연결 해제, 저장된 webhook 없음
- 알림 runtime flag: 설정 UI만 활성, provider/dispatch/shadow 활성화 없음

## 별도 운영 게이트

### 독립 발견된 prepare ACL 보정

이력 재매핑 뒤의 별도 운영 점검에서 정확한 함수 `public.prepare_notification_immediate_delivery_v1(text,uuid,uuid,uuid,text,text,text,bigint,uuid,bigint,bigint,timestamptz,jsonb)`가 `SECURITY DEFINER`이고 본문은 `service_role` 외 호출을 fail-closed 처리하지만, 운영 ACL에는 PostgreSQL 기본 PUBLIC EXECUTE와 `anon`·`authenticated` EXECUTE가 남아 있음이 확인되었다. `revalidate_immediate_notification_delivery_v1`와 `begin_notification_delivery_send_v1`는 이미 service-role-only였으므로 prepare 한 함수만의 독립 ACL 결함이다.

보정은 이미 적용된 `20260722120000_science_notification_connection.sql`이나 quarantine 원본을 수정·재실행하지 않고, active lane의 `20260722130000_notification_prepare_acl_hardening.sql` 한 건으로만 수행한다. 이 migration은 정확한 함수 존재와 `SECURITY DEFINER`를 먼저 확인하고 owner를 `postgres`로 고정한 뒤 PUBLIC·`anon`·`authenticated`·`service_role`의 기존 grant를 모두 회수하고 grant option 없는 EXECUTE를 `service_role`에만 다시 부여한다. 마지막 catalog 검사는 explicit ACL이 owner와 `service_role` EXECUTE 두 행뿐인지 확인해 예상 밖 역할 grant도 fail-closed 처리한다.

정식 DB CI 적용 시 의도한 변화는 함수 owner/ACL과 migration history 한 건뿐이다. 함수 본문·시그니처·데이터·runtime flags·연결 secret·cron·worker·provider 상태는 바꾸지 않는다. 기대 운영 post-state는 `service_role EXECUTE=true`, `anon/authenticated EXECUTE=false`, PUBLIC 직접 grant 없음, service-role grant option 없음이다. 로컬 구현 단계에서는 DB를 직접 적용하거나 provider를 호출하지 않고, 공식 DB CI가 적용한 뒤 실제 post-state를 별도 증거로 남긴다.

다음 6개 알림 마이그레이션은 원격 이력 불일치와 무관한 정상 미적용 상태이며, 현재 `supabase/pending-migrations/notification-cutover/`의 immutable quarantine에 보존한다.

- `20260716195000_notification_workflow_legacy_closure.sql`
- `20260716195500_notification_worker_schedule.sql`
- `20260716195800_notification_registration_provider_claim.sql`
- `20260716195900_notification_control_plane_forward_compat.sql`
- `20260716196000_notification_shadow_fixture_runner.sql`
- `20260717145304_notification_shadow_deterministic_evidence.sql`

이 과거 6개 SQL은 reference-only이며 직접 적용하거나 active lane으로 복사·이름 변경·승격하지 않는다. 특히 과거 worker/forward-compat 본문은 현재 과학 인지 함수 `public.revalidate_immediate_notification_delivery_v1`와 `public.prepare_notification_immediate_delivery_v1`를 과학 지원 이전 정의로 덮어쓰고, 보정된 prepare ACL까지 되돌릴 수 있다.

향후 관찰을 다시 시작하더라도 24시간 이상 및 Asia/Seoul 기준 완결된 하루와 7일 운영 shadow 요구조건은 그대로 유지한다. 그 조건은 과거 SQL 적용 권한이 아니다. 최신 schema 기준의 새 forward-dated install migration과 service-role 전용 activation RPC를 별도로 설계·검증·승인한 뒤에만 새 전환 계획을 세운다.

## 재발 방지

- 운영 DB에 적용할 SQL은 먼저 정식 migration 파일로 커밋하고 CI를 통해 배포한다.
- 긴급 직접 적용이 필요하면 실행 전에 정식 버전과 원격 기록 버전이 동일하게 유지되는 방법을 확정한다.
- `db push` 실패 시 SQL 재실행 전에 `migration list`, 원격 이름 및 저장 SQL 해시를 비교한다.
- 운영 DB에서 `db reset --linked`를 실행하지 않는다.
- quarantine 원본의 raw SHA-256뿐 아니라 근접 복사 방어용 `sql_lex_v1` lexical SHA-256, bare reserved/activation marker, family threshold를 함께 검사한다. outer comment·공백·case·lowercase quote·dollar tag 변경이나 핵심 상수 일부 변경은 승격 권한이 아니다. generic dollar body는 opaque bytes이며 이 fingerprint를 PostgreSQL 의미 동등성 증명으로 사용하지 않는다.
- `.github/workflows` 아래 재귀적 YAML 집합은 `supabase-db-push.yml` 한 파일과 정확히 같아야 한다. sibling·nested workflow, symbolic link, wrapper·재사용 호출, multiline·줄 연속 DB push를 허용하지 않는다.
- 실행 순서는 Checkout → focused boundary test → layout verifier → secret-bearing step이다. Supabase secret은 검증 성공 뒤 Validate required secrets·Link project·Push migrations의 해당 step `env`에만 둔다. DB push는 정확히 한 줄의 `supabase db push --linked --include-all`만 허용한다.
- workflow 전체 SHA-256 변경은 별도 boundary-security 검토와 테스트 독립 상수의 동시 갱신을 요구한다.

코드 검증기와 테스트는 악의적 maintainer까지 차단하는 완전한 보안 경계가 아니다. 같은 권한으로 검증기·테스트·workflow·고정 hash를 함께 바꿀 수 있기 때문이다. branch protection, `CODEOWNERS` 필수 리뷰, protected environment 승인, Supabase secret 최소 권한은 별도 저장소 거버넌스이며 이번 복구·강화 작업에서는 설정을 변경하지 않았다. 이 거버넌스가 별도로 확인되지 않은 상태에서 코드 검증 통과를 운영 DB 적용 또는 알림 전환 승인으로 해석하지 않는다.

참고: [Supabase Database Migrations](https://supabase.com/docs/guides/deployment/database-migrations)
