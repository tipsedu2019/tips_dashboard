-- Homepage presentation content is separate from operational teacher accounts/classes.
-- All writes pass the admin-only atomic gateway; anonymous reads expose published data only.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create function public.valid_public_site_data_v1(p_kind text,p_data jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog as $$
declare allowed text[]; k text; value text;
begin
 if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>40000 then return false;end if;
 allowed:=case p_kind when 'teacher' then array['name','subject','description','portraitUrl','videoUrl','legacyId'] when 'review' then array['name','role','content','subject','date'] when 'result' then array['year','exam','school','grade','name','subject','teacher','score','rating','rank','detail'] else null end;
 if allowed is null or not p_data ?& allowed then return false;end if;
 for k,value in select key,val #>> '{}' from jsonb_each(p_data) as f(key,val) loop
  if not k=any(allowed) or jsonb_typeof(p_data->k)<>'string' or length(value)>8000 then return false;end if;
 end loop;
 if length(p_data->>'name') not between 1 and 80 then return false;end if;
 if p_kind='teacher' then
  if p_data->>'subject' not in ('','영어','수학','과학') or length(p_data->>'description')>2000 or coalesce(p_data->>'portraitUrl','')='' then return false;end if;
  if p_data->>'legacyId'<>'' and p_data->>'legacyId'!~'^0[1-7]$' then return false;end if;
  foreach k in array array['portraitUrl','videoUrl'] loop
   value:=p_data->>k;
   if value<>'' and value!~'^(storage:teachers/[a-fA-F0-9-]{36}|/assets/(landing/)?v[0-9]+/[a-zA-Z0-9/_-]+)\.(png|jpg|jpeg|webp|mp4|webm)$' then return false;end if;
   if k='portraitUrl' and value!~'\.(png|jpg|jpeg|webp)$' then return false;end if;
   if k='videoUrl' and value<>'' and value!~'\.(mp4|webm)$' then return false;end if;
  end loop;
 else
  -- Only the masked public display name is stored for student/parent stories.
  if p_data->>'name'<>'익명' and (p_data->>'name')!~'^(익명|[가-힣A-Za-z][*○●•ㅇ]{1,6}[가-힣A-Za-z]?)([[:space:]]*[,·/;&][[:space:]]*(익명|[가-힣A-Za-z][*○●•ㅇ]{1,6}[가-힣A-Za-z]?))*$' then return false;end if;
 end if;
 if p_kind='review' then
  if p_data->>'role' not in ('학생','학부모님') or btrim(p_data->>'content', E' \t\r\n')='' or p_data->>'subject' not in ('','영어','수학','과학') then return false;end if;
  if p_data->>'date'<>'' then
   if p_data->>'date'!~'^\d{4}-\d{2}-\d{2}$' then return false;end if;
   begin if to_char((p_data->>'date')::date,'YYYY-MM-DD')<>p_data->>'date' then return false;end if; exception when others then return false;end;
  end if;
 end if;
 if p_kind='result' then
  if p_data->>'year'!~'^\d{4}$' or (p_data->>'year')::integer not between 2000 and 2100 then return false;end if;
  foreach k in array array['exam','school','grade','subject'] loop if length(btrim(p_data->>k))<1 or length(p_data->>k)>(case k when 'exam' then 80 when 'school' then 100 else 30 end) then return false;end if;end loop;
  if p_data->>'score'<>'' then if p_data->>'score'!~'^\d{1,3}(\.\d{1,2})?$' then return false;end if;if (p_data->>'score')::numeric>100 then return false;end if;end if;
  if p_data->>'score'='' and p_data->>'rating'='' and p_data->>'rank'='' then return false;end if;
  if length(p_data->>'teacher')>80 or length(p_data->>'rating')>30 or length(p_data->>'rank')>30 or length(p_data->>'detail')>120 then return false;end if;
 end if;
 return true;
end $$;
revoke all on function public.valid_public_site_data_v1(text,jsonb) from public,anon,authenticated;

create table public.public_site_entries(
 id uuid primary key,
 kind text not null check(kind in ('teacher','review','result')),
 data jsonb not null,
 search_text text generated always as (lower(coalesce(data->>'name','')||' '||coalesce(data->>'school','')||' '||coalesce(data->>'exam','')||' '||coalesce(data->>'content','')||' '||coalesce(data->>'teacher',''))) stored,
 -- This display order is explicitly bounded to 99999.
 -- squawk-ignore prefer-bigint-over-int
 sort_order integer not null default 0 check(sort_order between 0 and 99999),
 is_published boolean not null default false,
 -- Gateway expected versions accept at most nine digits; +1 still fits int32.
 -- squawk-ignore prefer-bigint-over-int
 version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 created_by uuid,
 updated_by uuid,
 constraint public_site_data_valid check(public.valid_public_site_data_v1(kind,data))
);
create index public_site_entries_browse on public.public_site_entries(kind,sort_order,id);
create index public_site_entries_published on public.public_site_entries(kind,sort_order,id) where is_published;
create unique index public_site_teacher_legacy_unique on public.public_site_entries((data->>'legacyId')) where kind='teacher' and data->>'legacyId'<>'';
alter table public.public_site_entries enable row level security;
revoke all on public.public_site_entries from public,anon,authenticated;
grant select(id,kind,data,sort_order,is_published) on public.public_site_entries to anon;
grant select on public.public_site_entries to authenticated;
create policy public_site_published_read on public.public_site_entries for select to anon using(is_published);
create policy public_site_admin_read on public.public_site_entries for select to authenticated using((select auth.uid()) is not null and (select public.current_dashboard_role())='admin');

create table public.public_site_write_receipts(request_id uuid primary key,payload_hash text not null,response jsonb not null,created_by uuid not null,created_at timestamptz not null default now());
alter table public.public_site_write_receipts enable row level security;
revoke all on public.public_site_write_receipts from public,anon,authenticated;

-- SECURITY DEFINER is limited to this explicit admin write gateway; callers never
-- receive table mutation privileges or the ability to forge idempotency receipts.
create function public.apply_public_site_changes_v1(p_request_id uuid,p_changes jsonb,p_bootstrap boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=auth.uid(); payload_hash text; receipt public.public_site_write_receipts%rowtype; item jsonb; draft jsonb; current_row public.public_site_entries%rowtype; expected integer; row_id uuid; response jsonb; changed jsonb:='[]'; seen integer;
begin
 if actor is null or public.current_dashboard_role() is distinct from 'admin' then raise exception using errcode='42501',message='public_content_admin_required';end if;
 if p_request_id is null or p_changes is null or jsonb_typeof(p_changes)<>'array' or jsonb_array_length(p_changes) not between 1 and 5000 then raise exception using errcode='22023',message='public_content_invalid_changes';end if;
 if p_bootstrap is null or not p_bootstrap and jsonb_array_length(p_changes)>500 then raise exception using errcode='22023',message='public_content_invalid_changes';end if;
 payload_hash:=encode(sha256(convert_to(p_changes::text||p_bootstrap::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 select * into receipt from public.public_site_write_receipts where request_id=p_request_id;
 if found then
  if receipt.created_by<>actor or receipt.payload_hash<>payload_hash then raise exception using errcode='P0001',message='public_content_request_reused';end if;
  return receipt.response;
 end if;
 if not p_bootstrap then lock table public.public_site_entries in row exclusive mode;end if;
 if p_bootstrap then
  lock table public.public_site_entries in share row exclusive mode;
  if exists(select 1 from public.public_site_entries) then raise exception using errcode='P0001',message='public_content_bootstrap_not_empty';end if;
 end if;
 select count(distinct value->>'id') into seen from jsonb_array_elements(p_changes);
 if seen<>jsonb_array_length(p_changes) then raise exception using errcode='22023',message='public_content_duplicate_id';end if;
 for item in select value from jsonb_array_elements(p_changes) order by value->>'id' loop
  if jsonb_typeof(item) is distinct from 'object' or not item ?& array['id','expectedVersion','action'] or jsonb_typeof(item->'id') is distinct from 'string' or jsonb_typeof(item->'expectedVersion') is distinct from 'number' or jsonb_typeof(item->'action') is distinct from 'string' or exists(select 1 from jsonb_object_keys(item) key where key<>all(case when item->>'action'='save' then array['id','expectedVersion','action','entry'] else array['id','expectedVersion','action'] end)) or item->>'action' not in ('save','delete') or item->>'expectedVersion'!~'^\d{1,9}$' or item->>'id'!~*'^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then raise exception using errcode='22023',message='public_content_invalid_change';end if;
  row_id:=(item->>'id')::uuid;expected:=(item->>'expectedVersion')::integer;
  perform pg_advisory_xact_lock(hashtextextended(row_id::text,1));
  select * into current_row from public.public_site_entries where id=row_id for update;
  if (not found and expected<>0) or (found and current_row.version<>expected) then raise exception using errcode='P0001',message='public_content_version_conflict';end if;
  if item->>'action'='delete' then
   if expected=0 then raise exception using errcode='22023',message='public_content_invalid_delete';end if;
   delete from public.public_site_entries where id=row_id;
   changed:=changed||jsonb_build_array(jsonb_build_object('id',row_id,'deleted',true));
  else
   draft:=item->'entry';
   if draft is null or jsonb_typeof(draft) is distinct from 'object' or not draft ?& array['kind','data','sortOrder','isPublished'] or jsonb_typeof(draft->'kind') is distinct from 'string' or jsonb_typeof(draft->'sortOrder') is distinct from 'number' or exists(select 1 from jsonb_object_keys(draft) key where key<>all(array['kind','data','sortOrder','isPublished'])) or not public.valid_public_site_data_v1(draft->>'kind',draft->'data') or draft->>'sortOrder'!~'^\d{1,5}$' or jsonb_typeof(draft->'isPublished')<>'boolean' then raise exception using errcode='22023',message='public_content_invalid_entry';end if;
   if expected=0 then
    insert into public.public_site_entries(id,kind,data,sort_order,is_published,created_by,updated_by)values(row_id,draft->>'kind',draft->'data',(draft->>'sortOrder')::integer,(draft->>'isPublished')::boolean,actor,actor);
   else
    if current_row.kind<>draft->>'kind' then raise exception using errcode='22023',message='public_content_kind_immutable';end if;
    update public.public_site_entries set data=draft->'data',sort_order=(draft->>'sortOrder')::integer,is_published=(draft->>'isPublished')::boolean,version=version+1,updated_at=now(),updated_by=actor where id=row_id;
   end if;
   changed:=changed||jsonb_build_array(jsonb_build_object('id',row_id,'version',expected+1));
  end if;
 end loop;
 response:=jsonb_build_object('applied',jsonb_array_length(p_changes),'entries',changed);
 insert into public.public_site_write_receipts(request_id,payload_hash,response,created_by)values(p_request_id,payload_hash,response,actor);
 return response;
end $$;
alter function public.apply_public_site_changes_v1(uuid,jsonb,boolean) owner to postgres;
revoke all on function public.apply_public_site_changes_v1(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.apply_public_site_changes_v1(uuid,jsonb,boolean) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)values('public-site-media','public-site-media',false,41943040,array['image/png','image/jpeg','image/webp','video/mp4','video/webm']);
create policy public_site_admin_media_read on storage.objects for select to authenticated using(bucket_id='public-site-media' and (select auth.uid()) is not null and (select public.current_dashboard_role())='admin');
commit;
