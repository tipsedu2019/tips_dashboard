# Registration Observation Migration Ledger Alignment Design

## 목적

Tasks 1–9에서 검토된 registration-observation 릴리스 SHA `97c6962dfb646a402345f1eb83ddacb4ff526e0e`를 Production에 적용하기 전에, Git의 migration 파일 집합과 Supabase Production의 `supabase_migrations.schema_migrations` ledger를 정확히 정합화한다.

이 작업은 로컬 소스와 검증 계약만 변경한다. feature ref push, GitHub DB workflow dispatch, `main` 변경, Production DB write, Vercel 배포, runtime/provider 활성화 및 provider 요청은 포함하지 않는다.

## 현재 상태와 차단 원인

읽기 전용 Production 조회 결과:

- 원격 migration version: `167`
- 릴리스 worktree의 로컬 migration version: `181`
- 원격에만 존재: `9`
- 로컬에만 존재: `23`
- Task 10 기존 명세가 허용한 pending set: `12`

따라서 현재 상태는 Task 10의 `not_installed`가 아니라 `drifted`다. GitHub Actions run `31291838811`도 `Remote migration versions not found in local migrations directory`로 실패했다.

### 원격에만 존재하는 9개 version

| Version | Name | Remote bytes | Remote MD5 |
|---|---|---:|---|
| `20260807030434` | `registration_korean_template_renderer` | 3370 | `c336c2f1f4f7cfcc51f9925af627828b` |
| `20260807111442` | `registration_management_google_chat_dispatch` | 20271 | `fd7a54af5ed0b655d463b72b07c41a86` |
| `20260807125038` | `registration_customer_message_preview_target_rpc` | 1702 | `91160a7b76a3095fef2977068ab90898` |
| `20260808044202` | `registration_level_test_summary_consultation_chat` | 7041 | `a86bc4849b518855e14466b26ca9ca24` |
| `20260808050410` | `registration_director_retry_circuit_breaker` | 1051 | `f3f1eacd9c1da6df9d1fb82ba2116882` |
| `20260808124315` | `registration_customer_message_subject_admission_details` | 32981 | `e67fce846f533a8e59acb4f890b37f92` |
| `20260811142055` | `science_consultation_requests` | 2912 | `f72b185bd72e1917077ade9514dcc0bd` |
| `20260811142152` | `science_consultation_requests_deny_policy` | 159 | `443fe5c62bb6160a3d401fcf9350362d` |
| `20260811142353` | `science_consultation_rate_limits` | 1472 | `7da951f5a4c896e15f22c4d2242c26c6` |

첫 여섯 migration은 로컬에 같은 이름과 다른 timestamp로 존재한다. 네 쌍은 바이트까지 동일하다. preview-target 쌍의 1바이트 차이는 파일 끝 개행이고, director 쌍의 220바이트 차이는 설명 주석뿐이다. 실행 SQL 의미의 차이는 없다.

마지막 세 science migration은 현재 Git ref에 파일이 없지만 Production ledger의 단일 stored statement와 byte count/MD5가 남아 있다.

## 선택한 접근법

Production migration history를 수정하지 않고 Git 소스를 Production의 이미 적용된 ledger에 맞춘다.

1. 같은 기능의 로컬 alternate-timestamp migration 여섯 개를 원격 version으로 이동한다.
2. 이동한 파일의 내용은 Production `statements[1]`의 정확한 바이트와 일치시킨다. 의미가 같은 주석·끝 개행도 원격 receipt 기준으로 맞춘다.
3. 세 science migration을 Production stored statement의 정확한 바이트로 복원한다.
4. 기존 alternate timestamp 여섯 개가 남아 있지 않음을 검사한다.
5. Production에 아직 없는 reviewed migration은 아래 17개만 허용한다.
6. Task 10의 pre-dispatch gate와 자동 검증을 exact 17-version set으로 개정한다.

`supabase migration repair`, `supabase db push --linked`, 직접 Production SQL write, 적용된 version 삭제 또는 workflow mismatch 무시는 사용하지 않는다.

## 정합화 후 허용되는 exact pending set

아래 순서가 유일하게 허용된다.

```text
20260809100000
20260809101000
20260809102000
20260809102200
20260809102400
20260809102450
20260809102500
20260809103000
20260809103500
20260809104000
20260809104500
20260809105000
20260809106000
20260809106100
20260809106200
20260812002019
20260812003000
```

기존 Task 10의 12개에 다음 reviewed dependency 다섯 개를 추가한 집합이다.

- `20260809102200_registration_observation_shared_event_filter.sql`
- `20260809102400_registration_observation_core_review_fixes.sql`
- `20260809102450_registration_observation_core_review_followup.sql`
- `20260812002019_notification_adapters_forward_install.sql`
- `20260812003000_notification_delivery_pending_schedule_fix.sql`

## 파일과 계약

### Migration source alignment

- 여섯 alternate-timestamp 파일은 동일 이름의 원격 timestamp 경로로 이동한다.
- 세 science 파일은 원격 statement receipt에서 복원한다.
- 각 원격-aligned 파일은 version, name, byte count 및 MD5를 고정한 테스트로 검증한다.
- 테스트 fixture에 SQL 전체를 중복 저장하지 않는다. 파일 자체의 bytes를 해시하고 고정 manifest와 비교한다.

### Release preflight contract

- Task 10 계획 문서의 expected pending set은 exact 17개로 바꾼다.
- read-only ledger preflight는 `remote-only = 0`, `local-only = exact 17`, `unreviewed pending = 0`을 요구한다.
- remote version/name뿐 아니라 복원한 9개 source receipt의 byte count/MD5도 비교한다.
- 하나라도 다르면 `drifted`로 판정하고 feature push 전 중단한다.

### Runtime and provider boundary

- migration source alignment는 runtime version, rule enabled 상태, SOLAPI mode, template receipt, outbox/job/event 또는 provider attempt를 변경하지 않는다.
- 정합화 구현과 검증은 disposable local DB 및 read-only Production metadata만 사용한다.
- Task 10 rollout은 별도 명시적 승인 없이는 시작하지 않는다.

## 데이터 흐름

```text
Production schema_migrations statements (read-only)
  -> exact version/name/bytes/hash receipt
  -> Git migration source restoration
  -> static manifest verification
  -> clean disposable DB migration/test run
  -> read-only Production ledger comparison
  -> independent review
  -> STOP before feature push
```

## 오류 처리

- 원격 statement가 없거나 cardinality가 `1`이 아니면 중단한다.
- version/name/byte count/MD5가 표와 다르면 중단한다.
- alternate timestamp 파일이 하나라도 남아 있으면 중단한다.
- local-only set이 exact 17과 다르면 중단한다.
- disposable DB에서 복원 migration이 실패하면 Production history를 수선하지 않고 로컬 소스를 수정한다.
- Production metadata 조회 권한이 없으면 operator estimate나 hand-authored receipt로 대체하지 않는다.

## 검증 전략

1. **Static RED/GREEN**: 현재 트리에서 remote-only 9개가 누락되고 alternate 6개가 존재해 실패하는 source-ledger test를 먼저 작성한다.
2. **Exact bytes**: 복원 후 9개 파일의 byte count/MD5가 위 manifest와 일치하는지 검증한다.
3. **Set equality**: Production read-only ledger와 로컬 version을 비교해 remote-only `0`, local-only exact 17을 증명한다.
4. **Disposable DB**: 전체 migration layout 검사와 registration-observation/SOLAPI local DB QA를 실행한다.
5. **Regression**: 관련 Node tests, lint, TypeScript, `next build --webpack`, `git diff --check`를 실행한다.
6. **Mutation sensitivity**: version 하나 변경, alternate 파일 하나 복원, hash 하나 변경 시 source-ledger test가 각각 실패하는지 확인한다.
7. **Independent review**: migration ordering, exact receipt, pending set, Production-write 금지선을 별도 검토한다.

## 완료 조건

- 9개 원격 version이 Git에 정확히 존재한다.
- 6개 alternate timestamp version은 Git에 존재하지 않는다.
- 복원 파일 9개의 version/name/byte count/MD5가 Production receipt와 일치한다.
- local-only set은 exact 17이며 remote-only set은 `0`이다.
- 로컬 migration/test/build gate가 모두 통과한다.
- 독립 리뷰에서 Critical/Important finding이 없다.
- feature push, Production DB write, `main`, Vercel, activation 및 provider call은 모두 `0`이다.

이 완료 조건은 Task 10 rollout 준비가 복구됐다는 뜻일 뿐 Production 배포 완료를 의미하지 않는다.
