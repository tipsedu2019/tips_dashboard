-- Stable textbook taxonomy is computed once on insert/update, not on every
-- page and summary read. Generated storage preserves immediate freshness.
-- If the taxonomy inference function changes, rebuild this generated column in
-- that migration: replacing an immutable function alone does not backfill it.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '10s';
create function dashboard_private.textbook_stored_taxonomy_v1(
 p_title text,p_name text,p_subject text,p_category text,p_publisher text,p_isbn13 text,p_barcode text,
 p_school_level text,p_grade_level text,p_school_levels text[],p_grade_levels text[],p_sub_subject text
) returns jsonb language sql immutable security invoker set search_path='' as $f$
 select dashboard_private.textbook_taxonomy_v1(jsonb_build_object('title',p_title,'name',p_name,'subject',p_subject,'category',p_category,'publisher',p_publisher,
 'isbn13',p_isbn13,'barcode',p_barcode,'school_level',p_school_level,'grade_level',p_grade_level,'school_levels',p_school_levels,'grade_levels',p_grade_levels,'sub_subject',p_sub_subject))
$f$;
revoke all on function dashboard_private.textbook_stored_taxonomy_v1(text,text,text,text,text,text,text,text,text,text[],text[],text) from public,anon;
grant execute on function dashboard_private.textbook_stored_taxonomy_v1(text,text,text,text,text,text,text,text,text,text[],text[],text) to authenticated,service_role;
-- Existing service-role INSERT/UPDATE must also execute the pure inference chain.
-- These immutable invokers only transform their arguments; no data-bearing read
-- guard or projection is granted, and PUBLIC/anon privileges stay unchanged.
grant execute on function
 dashboard_private.textbook_taxonomy_v1(jsonb),
 dashboard_private.textbook_trim_v1(text),
 dashboard_private.textbook_subject_v1(text),
 dashboard_private.textbook_school_v1(text),
 dashboard_private.textbook_grade_v1(text),
 dashboard_private.textbook_compact_v1(text)
 to service_role;
-- One-time rewrite: production preflight on 2026-09-27 counted 371 textbooks
-- (400 KiB total). Keep generated values atomic with existing writes; abort
-- rather than continue if lock acquisition exceeds 5s or rewriting exceeds 10s.
-- squawk-ignore adding-field-with-default
alter table public.textbooks add column read_taxonomy jsonb generated always as (
 dashboard_private.textbook_stored_taxonomy_v1(title,name,subject,category,publisher,isbn13,barcode,school_level,grade_level,school_levels,grade_levels,sub_subject)
) stored;
create or replace function dashboard_private.textbook_read_keys_v1(p_location text default '')
returns table(id uuid,title text,subject text,active boolean,taxonomy jsonb,quality jsonb,quality_score integer,
 total_quantity numeric,student_quantity numeric,teacher_quantity numeric,stock_value numeric,current_quantity numeric,
 latest_count_at text,days_since numeric,audit_status text)
language plpgsql stable security invoker set search_path='' as $$ begin
  perform dashboard_private.textbook_read_guard_v1();
  p_location:=lower(p_location);
  return query with books as materialized (
    select t.id,dashboard_private.textbook_trim_v1(coalesce(nullif(t.title,''),t.name,'')) title,dashboard_private.textbook_subject_v1(t.subject) subject,
      lower(dashboard_private.textbook_trim_v1(t.status)) not in ('inactive','미사용') active,
      t.read_taxonomy taxonomy,
      dashboard_private.textbook_compact_v1(coalesce(nullif(t.title,''),t.name,'')) title_key,
      dashboard_private.textbook_trim_v1(coalesce(nullif(t.isbn13,''),t.barcode,''))='' missing_code,dashboard_private.textbook_trim_v1(coalesce(t.publisher,'')) in ('','미분류') missing_publisher,
      coalesce(nullif(t.sale_price,0),nullif(t.price,0),t.list_price,0)<=0 missing_price,
      lower(regexp_replace(dashboard_private.textbook_trim_v1(coalesce(nullif(t.title,''),t.name,'')),'[[:space:]]+',' ','g')) hint_title
    from public.textbooks t
  ), duplicates as (select b.title_key from books b where b.active and b.title_key<>'' group by b.title_key having count(*)>1),
  balances as (select m.textbook_id,sum(m.quantity)::numeric total,sum(m.quantity) filter(where m.copy_scope='student')::numeric student,
    sum(m.quantity) filter(where m.copy_scope='teacher')::numeric teacher,sum(case when m.amount<>0 then m.amount else m.unit_amount*m.quantity end) value,
    sum(m.quantity) filter(where p_location='' or m.location_id::text=p_location)::numeric current
    from public.textbook_stock_moves m group by m.textbook_id),
  flags as (select b.*,jsonb_build_object('duplicate',d.title_key is not null,'missingCode',b.missing_code,'missingPublisher',b.missing_publisher,
    'missingCategory',b.taxonomy->>'schoolScalar'='' and b.taxonomy->>'gradeScalar'='' and b.taxonomy->>'subSubject'='' and b.taxonomy->>'categoryLabel'='미분류',
    'missingPrice',b.missing_price,'subjectMismatch',
      (b.subject='english' and (b.hint_title ~ '(수학|rpm|알피엠|개념원리|확률|통계|미적분|대수)' or b.hint_title ~* '(^|[^가-힣a-z0-9])수[[:space:]]?[12ⅠⅡ]($|[^가-힣a-z0-9])'))
      or (b.subject='math' and b.hint_title ~ '(영어|english|reading|writing|grammar|독해|구문|어법|영단어|리스닝)'), 'inactive',not b.active) quality
    from books b left join duplicates d on d.title_key=b.title_key),
  prepared as (select b.id,b.title,b.subject,b.active,b.taxonomy,b.quality,
    ((b.quality->>'subjectMismatch')::boolean::integer*16+(b.quality->>'duplicate')::boolean::integer*8+
    (b.quality->>'missingPublisher')::boolean::integer*4+(b.quality->>'missingCategory')::boolean::integer*4+
    (b.quality->>'missingPrice')::boolean::integer*4+(b.quality->>'missingCode')::boolean::integer*2+(b.quality->>'inactive')::boolean::integer) score,
    coalesce(m.total,0) total,coalesce(m.student,0) student,coalesce(m.teacher,0) teacher,coalesce(m.value,0) value,coalesce(m.current,0) current,
    coalesce(c.counted_at::text,'') latest,
    case when isfinite(c.counted_at) then floor(extract(epoch from(now()-(c.counted_at::timestamp at time zone 'UTC')))/86400) end days
    from flags b left join balances m on m.textbook_id=b.id
    -- Equal date is stabilized by descending UUID, not treated as chronological.
    left join lateral (select sc.counted_at from public.textbook_stock_counts sc where sc.textbook_id=b.id and sc.location_id::text=p_location order by sc.counted_at desc,sc.id desc limit 1)c on true)
  select p.id,p.title,p.subject,p.active,p.taxonomy,p.quality,p.score,p.total,p.student,p.teacher,p.value,p.current,p.latest,p.days,
    case when p.active and (p.current<=3 or p.latest='' or p.days is null or p.days>=30) then 'recommended'
      when p.latest<>'' and p.days<30 then 'done' else 'pending' end from prepared p;
end $$;
-- Latest entry into the current task status; excludes unrelated audit events.
-- Production preflight counted 1,511 events (13.5 MiB heap), with no waiting
-- locks. Build atomically with the taxonomy change so failure rolls both back.
-- The 5s lock and 10s statement limits bound this one-time write interruption;
-- a timeout requires rescheduling, not an automatic retry or timeout increase.
-- squawk-ignore require-concurrent-index-creation
create index ops_task_events_status_entered_idx
 on public.ops_task_events(task_id,after_value,created_at desc)
 where field_name='status';
commit;
