# Supabase Resource Pressure Runbook

## 목적

TIPS Dashboard의 로그인·대시보드·등록 화면이 함께 지연되거나 Supabase가 `Unhealthy`가 될 때, 증상 완화와 원인 확인을 분리한다. 고객 메시지 발송, 데이터 삭제, 유료 플랜 변경은 복구 명령으로 사용하지 않는다.

## 1. 현재 상태 확인

Supabase 프로젝트 상태와 API/Auth/Postgres 최근 로그를 먼저 확인한다. HTML/Vercel이 200이어도 Auth, REST, SQL이 함께 5xx 또는 timeout이면 애플리케이션 route 장애로 단정하지 않는다.

```sql
select
  pg_catalog.clock_timestamp() as checked_at,
  pg_catalog.pg_is_in_recovery() as in_recovery,
  pg_catalog.count(*) filter (where state = 'active') as active_sessions,
  pg_catalog.count(*) filter (where wait_event is not null) as waiting_sessions,
  pg_catalog.count(*) filter (where state = 'idle in transaction') as idle_in_transaction
from pg_catalog.pg_stat_activity;
```

```sql
select
  blocked.pid as blocked_pid,
  blocking.pid as blocking_pid,
  blocked.wait_event_type,
  blocked.wait_event,
  pg_catalog.clock_timestamp() - blocked.query_start as blocked_for
from pg_catalog.pg_stat_activity blocked
join pg_catalog.pg_locks blocked_lock on blocked_lock.pid = blocked.pid and not blocked_lock.granted
join pg_catalog.pg_locks blocking_lock
  on blocking_lock.locktype = blocked_lock.locktype
 and blocking_lock.database is not distinct from blocked_lock.database
 and blocking_lock.relation is not distinct from blocked_lock.relation
 and blocking_lock.page is not distinct from blocked_lock.page
 and blocking_lock.tuple is not distinct from blocked_lock.tuple
 and blocking_lock.virtualxid is not distinct from blocked_lock.virtualxid
 and blocking_lock.transactionid is not distinct from blocked_lock.transactionid
 and blocking_lock.classid is not distinct from blocked_lock.classid
 and blocking_lock.objid is not distinct from blocked_lock.objid
 and blocking_lock.objsubid is not distinct from blocked_lock.objsubid
 and blocking_lock.granted
join pg_catalog.pg_stat_activity blocking on blocking.pid = blocking_lock.pid;
```

## 2. 반복 전체 조회 확인

```sql
select
  queryid,
  calls,
  pg_catalog.round(total_exec_time::numeric, 1) as total_ms,
  pg_catalog.round(mean_exec_time::numeric, 1) as mean_ms,
  rows,
  pg_catalog.left(pg_catalog.regexp_replace(query, '\s+', ' ', 'g'), 240) as query
from extensions.pg_stat_statements
where query ilike '%from%classes%'
   or query ilike '%from%textbooks%'
   or query ilike '%from%progress_logs%'
order by total_exec_time desc
limit 30;
```

현재 payload 크기는 전체 JSON과 경량 projection을 따로 잰다.

```sql
select
  pg_catalog.octet_length(pg_catalog.coalesce(pg_catalog.jsonb_agg(c.*)::text, '[]')) as full_classes_bytes,
  pg_catalog.octet_length(pg_catalog.coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'subject', c.subject,
      'grade', c.grade,
      'teacher', c.teacher,
      'room', c.room,
      'schedule', c.schedule,
      'status', c.status,
      'start_date', c.start_date,
      'end_date', c.end_date,
      'student_ids', c.student_ids,
      'waitlist_ids', c.waitlist_ids,
      'schedule_storage_mode', c.schedule_storage_mode
    )
  )::text, '[]')) as narrow_classes_bytes
from public.classes c;
```

## 3. 리마인드 OFF/cron 일치 확인

```sql
select
  settings.enabled,
  settings.lead_hours,
  settings.revision,
  job.jobid,
  job.active,
  job.schedule,
  pg_catalog.btrim(job.command) as command
from dashboard_private.registration_customer_reminder_settings settings
left join cron.job job
  on job.jobname = 'tips-registration-customer-reminder-v1'
where settings.singleton;
```

정상 계약은 `enabled=false`일 때 `active=false`이다. OFF 상태에서 `dashboard_private.invoke_registration_customer_reminder_worker_v1()`는 `null`을 반환해야 하며 heartbeat, `net.http_post`, provider outbox를 만들면 안 된다.

```sql
select status, count(*)
from cron.job_run_details
where jobid in (
  select jobid from cron.job where jobname = 'tips-registration-customer-reminder-v1'
)
  and start_time >= pg_catalog.clock_timestamp() - interval '24 hours'
group by status
order by status;
```

## 4. RLS 정책과 scan 확인

```sql
select tablename, cmd, count(*) as policy_count
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename in (
    'profiles', 'classes', 'textbooks', 'ops_tasks', 'ops_task_events',
    'ops_registration_subject_tracks', 'ops_registration_appointments',
    'ops_registration_level_tests', 'ops_registration_consultations',
    'ops_registration_admission_batches', 'ops_registration_enrollments',
    'ops_registration_details'
  )
group by tablename, cmd
order by tablename, cmd;
```

```sql
select
  relname,
  seq_scan,
  seq_tup_read,
  idx_scan,
  n_live_tup
from pg_catalog.pg_stat_user_tables
where relname in (
  'profiles', 'classes', 'textbooks', 'ops_tasks', 'ops_task_events',
  'ops_registration_subject_tracks', 'ops_registration_consultations',
  'ops_registration_enrollments'
)
order by seq_tup_read desc;
```

누적 counter는 배포 직전 값을 함께 기록하고 증가량으로 비교한다. 과거 전체 누적값만으로 현재 변경의 효과를 판단하지 않는다.

## 5. 장애 시 복구 순서

1. API/Auth/Postgres 오류와 Disk I/O/CPU를 캡처한다.
2. 동시 장애이며 SQL 접속도 실패하면 정확한 프로젝트 한 개에 `Restart project`를 한 번만 실행한다.
3. 재시작 중에 pause/restore 또는 두 번째 restart를 겹치지 않는다.
4. `ACTIVE_HEALTHY`, `select 1`, Auth 200, REST 최소 조회를 각각 확인한다.
5. 실제 로그인과 핵심 화면을 확인한다.
6. 재시작은 원인 해결로 보고하지 않고, 위 전체 조회·cron·RLS 증가량을 확인한다.

## 6. 배포 후 확인

- `/sign-in`
- `/admin/dashboard`
- `/admin/registration`
- `/admin/makeup-requests`
- `/admin/academic-calendar`
- `/api/public-classes`

최소 30분 동안 Supabase API/Auth/Postgres 5xx, statement timeout, cron 오실행, Disk I/O 상태를 확인한다. 코드 개선 뒤에도 피크 시간에 Disk I/O 버스트가 반복 소진되면 Supabase 공식 compute/disk 기준을 다시 확인하고, 예상 월 비용을 사용자에게 제시한 뒤 유료 컴퓨트 상향 승인을 별도로 받는다.

## 7. 변경 전후 read-only resource evidence

운영 DB에는 아래 collector가 허용하는 Management API read-only 요청만 사용한다. 토큰, DB URL, 비밀번호는 인자·로그·evidence 파일에 넣지 않는다. `plan`은 section ID·checksum·row/payload budget만 보여 준다.

```bash
"$TASK_NODE" scripts/collect-supabase-resource-evidence.mjs --mode plan
"$TASK_NODE" scripts/collect-supabase-resource-evidence.mjs \
  --mode execute --authorized --request-id "$TASK_REQUEST_ID" \
  --output "$TASK_EVIDENCE_OUTPUT"
```

`execute`에는 absolute output path, `SUPABASE_DATABASE_READ_TOKEN` (`database_read`, 필요하면 `advisors_read`)과 `SUPABASE_PROJECT_REF`가 필요하다. output은 기존 파일을 덮어쓰지 않고 0600 temporary file을 fsync한 뒤 atomic rename한다. DB bracket start/end 중 하나라도 실패하면 `evidence_bracket_incomplete`로 실패하며 파일은 쓰지 않는다.

source release 전 10분 이내 baseline capture, deployment completed 뒤 30±5분 capture를 수집한다. 다음 업무 피크에는 KST 기준 60분 시작/끝 capture 쌍을 별도로 수집한다. 다음 비교는 동일 project, Postgres version, database/statements reset marker, extension availability일 때만 delta를 의미 있게 취급한다.

```bash
"$TASK_NODE" scripts/compare-supabase-resource-evidence.mjs \
  --before "$TASK_EVIDENCE_BEFORE" --after "$TASK_EVIDENCE_AFTER" \
  --output "$TASK_EVIDENCE_COMPARISON_OUTPUT"
```

capture interval이 겹치거나 bracket/wall-clock ordering이 어긋나면 결과는 `unknown`이다. restart 직후의 단일 누적 counter만으로 index 제거 또는 리소스 회복을 결론 내리지 않는다.
