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

다음 6개 알림 마이그레이션은 원격 이력 불일치와 무관한 정상 미적용 상태다.

- `20260716195000_notification_workflow_legacy_closure.sql`
- `20260716195500_notification_worker_schedule.sql`
- `20260716195800_notification_registration_provider_claim.sql`
- `20260716195900_notification_control_plane_forward_compat.sql`
- `20260716196000_notification_shadow_fixture_runner.sql`
- `20260717145304_notification_shadow_deterministic_evidence.sql`

첫 파일은 `notification_contract_drain_not_complete` 관찰 조건을 통과하기 전까지 의도적으로 실패한다. 이 파일들을 적용 완료로 위장하거나 안전 게이트를 약화해서는 안 된다. 관찰 조건이 충족된 뒤 기존 알림 전환 절차로 별도 처리한다.

## 재발 방지

- 운영 DB에 적용할 SQL은 먼저 정식 migration 파일로 커밋하고 CI를 통해 배포한다.
- 긴급 직접 적용이 필요하면 실행 전에 정식 버전과 원격 기록 버전이 동일하게 유지되는 방법을 확정한다.
- `db push` 실패 시 SQL 재실행 전에 `migration list`, 원격 이름 및 저장 SQL 해시를 비교한다.
- 운영 DB에서 `db reset --linked`를 실행하지 않는다.

참고: [Supabase Database Migrations](https://supabase.com/docs/guides/deployment/database-migrations)
