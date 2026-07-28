# 연속 수업 일정 기반 전환 운영 가이드

## 범위

이 문서는 릴리스 1의 읽기 전용 증거 수집에만 사용한다. 수업명, 교사명, 강의실, 교재, 학생, 연락처, 원본 `schedule_plan`은 보고서에 출력하지 않는다.

필수 커밋은 연속 수업 일정 기반 전환 브랜치의 태스크 1~5 커밋이며, 대상 마이그레이션 파일은 `supabase/migrations/20260728130000_continuous_class_schedule_foundation.sql`이다.

## 실행 명령

```bash
TASK_NODE=/Users/hyunjun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$TASK_NODE" --experimental-strip-types scripts/preview-continuous-class-schedule-backfill.mjs --input /absolute/path/classes-export.json

"$TASK_NODE" --experimental-strip-types scripts/preview-continuous-class-schedule-backfill.mjs --live --class-id 10000000-0000-4000-8000-000000000001

"$TASK_NODE" --experimental-strip-types scripts/preview-continuous-class-schedule-backfill.mjs --live --all --confirm-all-read
```

파일 모드는 JSON 배열만 읽는다. Live 모드는 `.env.local`의 `NEXT_PUBLIC_SUPABASE_URL`과 `SUPABASE_SERVICE_ROLE_KEY`를 필요로 하며, 값을 출력하지 않는다. 전체 조회에는 반드시 `--confirm-all-read`가 필요하다.

## Redacted 보고서

보고서는 `schemaVersion`, 생성 시각, 전체 건수와 각 수업의 `classId`, `eligible`, `counts`, `issueCodes`, `shadowMatches`, `shadowIssueCodes`만 포함한다.

`missing_class_id`는 수업 ID가 없음을, `unparseable_default_schedule`은 기본 시간표를 정규화할 수 없음을 뜻한다. `missing_session_key`, `duplicate_session_key`, `missing_session_date`, `invalid_session_state`는 기존 일정의 검토가 필요함을 뜻한다.

`slot_count_mismatch`, `session_count_mismatch`, `missing_shadow_session`, `unexpected_shadow_session`, `session_date_mismatch`, `session_state_mismatch`는 shadow 행과 기존 일정의 불일치를 뜻한다.

## 중지 조건과 승인

보고서에 차단 이슈가 있거나 shadow 불일치가 있으면 이후 단계를 중지하고 원인을 검토한다. 릴리스 1에서는 연결된 데이터베이스·원격 데이터베이스에 마이그레이션을 적용하거나 런타임/저장 모드를 전환하지 않는다.

데이터베이스 마이그레이션 적용, 운영 데이터 읽기, 이후 backfill 쓰기는 각각 별도의 명시적 승인과 고추론 DB 안전 검토가 필요하다. 이 명령은 파일을 쓰지 않고, DB mutation RPC·insert·update·delete·upsert를 실행하지 않는다.
