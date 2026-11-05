-- Isolated synthetic diagnostic only; no production table/function/index/ACL DDL.
-- Run with psql -v ON_ERROR_STOP=1 in the parent's verified empty isolated DB.
-- Everything created here is rolled back. No extension or pgTAP is required.
--
-- Source: supabase/migrations/20260814115116_dashboard_audit_diff_format.sql
-- SHA256: 8fcd458950cee39866dc6be500628f79f4a9ad7a2ae45f54eefe683f79f0871d
-- Final log_dashboard_audit_event_v2(): predecessor SELECT at lines 163-167;
-- continuity guard/ordinal at 169-177; predecessor links at 195-196.
-- The later 20260922054047 and 20261022081000 schema-event writers do not
-- replace this trigger. Existing dashboard_audit_diff_format_test.sql and
-- probe-dashboard-audit-chain-concurrency.mjs were read, not rerun here.
--
-- This models only predecessor selection and its continuity decision. It does
-- not execute/copy the production trigger, actor/RLS checks, advisory lock,
-- sequence allocation, audit INSERT, patching, or concurrency behavior.
-- The real trigger locks the table/entity before selection; that remains an
-- untouched prerequisite. A fresh-chain marker stands in for UUID generation.
--
-- DESC means NULLS FIRST. Equal event_sequence has no secondary ordering:
-- either top tied row is legal, even when its identity/continuity differs.
-- No id/changed_at tie-break, NULLS LAST, hash prefilter, or fallback is added.
-- V2 NULL sequences and malformed continuity rows below deliberately violate
-- today's v2 shape check; they test query/guard behavior, not valid new writes.

begin;
set local statement_timeout = '15s';
set local lock_timeout = '2s';

do $$begin
  if pg_catalog.to_regclass('public.dashboard_audit_logs') is not null then
    raise exception 'issue234_audit_semantics_requires_empty_isolated_database';
  end if;
end$$;

create schema issue234_audit_predecessor_semantics;
create function issue234_audit_predecessor_semantics.fid(n integer)
returns uuid language sql immutable set search_path = '' as $$
  select ('a2340000-0000-4000-8000-' || pg_catalog.lpad(n::text,12,'0'))::uuid
$$;
create function issue234_audit_predecessor_semantics.row_hash(value jsonb)
returns text language sql immutable strict set search_path = '' as $$
  -- Same SHA-256 over JSONB text as extensions.digest(...,'sha256').
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(value::text,'UTF8')),'hex')
$$;
create table issue234_audit_predecessor_semantics.audit_log (
  id uuid primary key, entity_table text, entity_id text, record_format text,
  event_sequence bigint, changed_at timestamptz, action text, after_hash text,
  audit_chain_id uuid, chain_ordinal bigint
);
create table issue234_audit_predecessor_semantics.results (
  label text primary key, category text not null, details jsonb not null
);
create function issue234_audit_predecessor_semantics.check_case(
  label text, category text, passed boolean, details jsonb
) returns void language plpgsql set search_path = '' as $$begin
  if passed is distinct from true then
    raise exception using errcode='P0001',message='issue234_audit_semantics_failed',
      detail=label || ': ' || details::text;
  end if;
  insert into issue234_audit_predecessor_semantics.results values(label,category,details);
end$$;

create function issue234_audit_predecessor_semantics.original_lookup(
  tg_table_name text, audit_entity_id text
) returns issue234_audit_predecessor_semantics.audit_log
language plpgsql stable set search_path = '' as $$
declare selected issue234_audit_predecessor_semantics.audit_log;
begin
  select * into selected from issue234_audit_predecessor_semantics.audit_log
  where entity_table = tg_table_name and entity_id is not distinct from audit_entity_id
    and record_format in ('full_v2', 'diff_v2')
  order by event_sequence desc limit 1;
  return selected;
end$$;
create function issue234_audit_predecessor_semantics.candidate_lookup(
  tg_table_name text, audit_entity_id text
) returns issue234_audit_predecessor_semantics.audit_log
language plpgsql stable set search_path = '' as $$
declare selected issue234_audit_predecessor_semantics.audit_log;
begin
  if audit_entity_id is null then
    select * into selected from issue234_audit_predecessor_semantics.audit_log
    where entity_table = tg_table_name and entity_id is null
      and record_format in ('full_v2', 'diff_v2')
    order by event_sequence desc limit 1;
  else
    select * into selected from issue234_audit_predecessor_semantics.audit_log
    where entity_table = tg_table_name and entity_id = audit_entity_id
      and record_format in ('full_v2', 'diff_v2')
    order by event_sequence desc limit 1;
  end if;
  return selected;
end$$;

insert into issue234_audit_predecessor_semantics.audit_log
select issue234_audit_predecessor_semantics.fid(n),tbl,entity,fmt,seq,stamp,
  'UPDATE',issue234_audit_predecessor_semantics.row_hash(
    case when n=16 then '{"state":"other"}'::jsonb else '{"state":"before"}'::jsonb end),
  issue234_audit_predecessor_semantics.fid(900),3
from (values
  (1,'classes',null::text,'full_v2',10::bigint,'2000-01-01T00:00:00Z'::timestamptz),
  (2,'classes',null,'diff_v2',20,'2000-01-01T00:00:00Z'),
  (3,'classes','','diff_v2',30,'2000-01-01T00:00:00Z'),
  (4,'classes','null','diff_v2',40,'2000-01-01T00:00:00Z'),
  (5,'classes','sequence','full_v2',100,'2000-01-01T00:00:00Z'),
  (6,'classes','sequence','diff_v2',102,'2000-01-01T00:00:00Z'),
  (7,'classes','sequence','diff_v2',101,'2040-01-01T00:00:00Z'),
  (8,'classes','formats','full_v2',10,'2000-01-01T00:00:00Z'),
  (9,'classes','formats','diff_v2',20,'2000-01-01T00:00:00Z'),
  (10,'classes','formats','full_v1',999,'2000-01-01T00:00:00Z'),
  (11,'classes','formats',null,1000,'2000-01-01T00:00:00Z'),
  (12,'classes','formats','future_v3',1001,'2000-01-01T00:00:00Z'),
  (13,'classes','shared','diff_v2',5,'2000-01-01T00:00:00Z'),
  (14,'students','shared','diff_v2',1000,'2000-01-01T00:00:00Z'),
  (15,'classes','tie','full_v2',50,'2000-01-01T00:00:00Z'),
  (16,'classes','tie','diff_v2',50,'2040-01-01T00:00:00Z'),
  (17,'classes','tie','diff_v2',49,'2050-01-01T00:00:00Z'),
  (18,'classes','null-sequence','diff_v2',null,'2000-01-01T00:00:00Z'),
  (19,'classes','null-sequence','diff_v2',9223372036854775807,'2040-01-01T00:00:00Z'),
  (20,'classes','null-tie','full_v2',null,'2000-01-01T00:00:00Z'),
  (21,'classes','null-tie','diff_v2',null,'2040-01-01T00:00:00Z'),
  (22,'classes','null-tie','diff_v2',100,'2050-01-01T00:00:00Z'),
  (23,'classes','negative-sequence','full_v2',-9,'2040-01-01T00:00:00Z'),
  (24,'classes','negative-sequence','diff_v2',-1,'2000-01-01T00:00:00Z')
) seed(n,tbl,entity,fmt,seq,stamp);

do $$
declare c record; original issue234_audit_predecessor_semantics.audit_log;
  candidate issue234_audit_predecessor_semantics.audit_log; allowed uuid[]; pass boolean;
begin
  for c in select * from (values
    ('NULL entity is distinct from empty and literal null','classes',null::text,array[2]),
    ('empty entity is not NULL','classes','',array[3]),
    ('missing entity returns no predecessor','classes','absent',array[]::integer[]),
    ('sequence wins over identical or later changed_at','classes','sequence',array[6]),
    ('only full_v2 and diff_v2 participate','classes','formats',array[9]),
    ('other entity tables cannot win','classes','shared',array[13]),
    ('finite sequence tie retains unspecified identity','classes','tie',array[15,16]),
    ('DESC preserves default NULLS FIRST','classes','null-sequence',array[18]),
    ('NULL sequence tie retains unspecified identity','classes','null-tie',array[20,21]),
    ('absent entity table returns no predecessor','lessons','shared',array[]::integer[]),
    ('NULL entity table still uses ordinary equality',null,'shared',array[]::integer[]),
    ('signed bigint ordering is preserved','classes','negative-sequence',array[24])
  ) cases(label,tbl,entity,ids) loop
    select coalesce(pg_catalog.array_agg(issue234_audit_predecessor_semantics.fid(n)),array[]::uuid[])
      into allowed from pg_catalog.unnest(c.ids) n;
    original:=issue234_audit_predecessor_semantics.original_lookup(c.tbl,c.entity);
    candidate:=issue234_audit_predecessor_semantics.candidate_lookup(c.tbl,c.entity);
    pass:=case when pg_catalog.cardinality(allowed)=0 then original.id is null and candidate.id is null
      else original.id=any(allowed) and candidate.id=any(allowed) end;
    -- Exact complete-row parity is required for every unique/no-match result.
    -- Tied identities may differ; neither query promises a particular member.
    if pg_catalog.cardinality(allowed)<=1 then
      pass:=pass and pg_catalog.to_jsonb(original) is not distinct from pg_catalog.to_jsonb(candidate);
    end if;
    perform issue234_audit_predecessor_semantics.check_case(c.label,'lookup',pass,
      pg_catalog.jsonb_build_object('allowedIds',allowed,'originalId',original.id,
        'candidateId',candidate.id,'tieIdentityGuaranteed',pg_catalog.cardinality(allowed)<=1));
  end loop;
end$$;

-- These synthetic rows isolate each unchanged fail-closed guard term.
insert into issue234_audit_predecessor_semantics.audit_log
select issue234_audit_predecessor_semantics.fid(n),'classes',entity,'diff_v2',seq,
  '2000-01-01T00:00:00Z'::timestamptz,action,
  case when hash_kind='before' then issue234_audit_predecessor_semantics.row_hash('{"state":"before"}')
       when hash_kind='other' then issue234_audit_predecessor_semantics.row_hash('{"state":"other"}') end,
  case when has_chain then issue234_audit_predecessor_semantics.fid(900) end,ordinal
from (values
  (101,'compatible','UPDATE','before',true,7::bigint,1::bigint),
  (102,'mismatch','UPDATE','other',true,7,1),
  (103,'null-after','UPDATE',null,true,7,1),
  (104,'deleted','DELETE','before',true,7,1),
  (105,'null-chain','UPDATE','before',false,7,1),
  (106,'null-ordinal','UPDATE','before',true,null,1),
  (107,'zero-ordinal','UPDATE','before',true,0,1),
  (108,'latest-bad','UPDATE','other',true,8,2),
  (109,'latest-bad','UPDATE','before',true,7,1),
  (110,'latest-deleted','DELETE',null,true,8,2),
  (111,'latest-deleted','UPDATE','before',true,7,1)
) seed(n,entity,action,hash_kind,has_chain,ordinal,seq);

create function issue234_audit_predecessor_semantics.continuity_decision(
  tg_op text, audit_predecessor issue234_audit_predecessor_semantics.audit_log, audit_before_hash text
) returns jsonb language plpgsql immutable set search_path = '' as $$
declare audit_ordinal bigint; audit_start_kind text; fresh_chain boolean:=false;
begin
  if tg_op='INSERT' then
    audit_ordinal:=1; audit_start_kind:='insert'; fresh_chain:=true;
  elsif audit_predecessor.id is null then
    -- A selected fixture row always has a non-NULL primary key; NULL means the
    -- original SELECT INTO found no row, i.e. the trigger's NOT FOUND branch.
    audit_ordinal:=1; audit_start_kind:='migration_boundary'; fresh_chain:=true;
  else
    -- Exact production guard, including IS DISTINCT FROM and error identity.
    if audit_predecessor.action = 'DELETE'
      or audit_predecessor.after_hash is distinct from audit_before_hash
      or audit_predecessor.audit_chain_id is null
      or audit_predecessor.chain_ordinal is null then
      raise exception 'audit_chain_continuity_invalid' using errcode = '55000';
    end if;
    audit_ordinal:=audit_predecessor.chain_ordinal+1; audit_start_kind:=null;
  end if;
  return pg_catalog.jsonb_build_object('freshChain',fresh_chain,
    'chainId',case when not fresh_chain then audit_predecessor.audit_chain_id end,
    'ordinal',audit_ordinal,'startKind',audit_start_kind,
    'predecessorId',case when audit_ordinal>1 then audit_predecessor.id end,
    'predecessorAfterHash',case when audit_ordinal>1 then audit_predecessor.after_hash end);
end$$;
create function issue234_audit_predecessor_semantics.continuity_outcome(
  use_candidate boolean,tg_op text,entity text,before_hash text
) returns jsonb language plpgsql stable set search_path = '' as $$
declare predecessor issue234_audit_predecessor_semantics.audit_log; result jsonb; code text; msg text;
begin
  predecessor:=case when use_candidate
    then issue234_audit_predecessor_semantics.candidate_lookup('classes',entity)
    else issue234_audit_predecessor_semantics.original_lookup('classes',entity) end;
  result:=issue234_audit_predecessor_semantics.continuity_decision(tg_op,predecessor,before_hash);
  return pg_catalog.jsonb_build_object('sqlstate','00000','message',null,'value',result);
exception when others then
  get stacked diagnostics code=returned_sqlstate,msg=message_text;
  return pg_catalog.jsonb_build_object('sqlstate',code,'message',msg,'value',null);
end$$;

do $$
declare c record; original jsonb; candidate jsonb; expected jsonb; expected_value jsonb;
  h text:=issue234_audit_predecessor_semantics.row_hash('{"state":"before"}');
begin
  for c in select * from (values
    ('INSERT starts a fresh chain despite a bad existing predecessor','INSERT','deleted','before','00000',true,'insert',1::bigint,null::integer),
    ('UPDATE without v2 history starts a migration boundary','UPDATE','absent','before','00000',true,'migration_boundary',1,null),
    ('DELETE without v2 history starts a migration boundary','DELETE','absent','before','00000',true,'migration_boundary',1,null),
    ('UPDATE preserves hash chain ordinal and predecessor','UPDATE','compatible','before','00000',false,null,8,101),
    ('DELETE requires and preserves compatible predecessor','DELETE','compatible','before','00000',false,null,8,101),
    ('NULL entity preserves the same continuity decision','UPDATE',null,'before','00000',false,null,4,2),
    ('empty entity preserves the same continuity decision','UPDATE','','before','00000',false,null,4,3),
    ('mismatching before hash remains rejected','UPDATE','mismatch','before','55000',false,null,null,null),
    ('NULL predecessor after hash remains rejected','UPDATE','null-after','before','55000',false,null,null,null),
    ('NULL incoming before hash remains rejected','UPDATE','compatible',null,'55000',false,null,null,null),
    ('deleted predecessor remains rejected even if hash matches','UPDATE','deleted','before','55000',false,null,null,null),
    ('missing chain ID remains rejected','UPDATE','null-chain','before','55000',false,null,null,null),
    ('missing chain ordinal remains rejected','UPDATE','null-ordinal','before','55000',false,null,null,null),
    ('latest bad hash cannot fall back to older matching history','UPDATE','latest-bad','before','55000',false,null,null,null),
    ('latest DELETE cannot fall back to older live history','UPDATE','latest-deleted','before','55000',false,null,null,null),
    ('zero ordinal retains existing increment and link rule','UPDATE','zero-ordinal','before','00000',false,null,1,null)
  ) cases(label,op,entity,hash_kind,code,fresh_chain,start_kind,ordinal,predecessor_id) loop
    original:=issue234_audit_predecessor_semantics.continuity_outcome(false,c.op,c.entity,case when c.hash_kind='before' then h end);
    candidate:=issue234_audit_predecessor_semantics.continuity_outcome(true,c.op,c.entity,case when c.hash_kind='before' then h end);
    expected_value:=case when c.code='00000' then pg_catalog.jsonb_build_object(
      'freshChain',c.fresh_chain,'chainId',case when not c.fresh_chain then issue234_audit_predecessor_semantics.fid(900) end,
      'ordinal',c.ordinal,'startKind',c.start_kind,
      'predecessorId',case when c.predecessor_id is not null then issue234_audit_predecessor_semantics.fid(c.predecessor_id) end,
      'predecessorAfterHash',case when c.predecessor_id is not null then h end) end;
    expected:=pg_catalog.jsonb_build_object('sqlstate',c.code,
      'message',case when c.code='55000' then 'audit_chain_continuity_invalid' end,'value',expected_value);
    perform issue234_audit_predecessor_semantics.check_case(c.label,'continuity',
      original=expected and candidate=expected,
      pg_catalog.jsonb_build_object('original',original,'candidate',candidate,'expected',expected));
  end loop;
end$$;

do $$begin
  if (select count(*) from issue234_audit_predecessor_semantics.results)<>28 then
    raise exception 'issue234_audit_semantics_assertion_count';
  end if;
end$$;
select pg_catalog.jsonb_build_object('diagnostic','issue234_audit_predecessor_semantics',
  'status','pass','assertions',count(*),
  'lookupCases',count(*) filter(where category='lookup'),
  'continuityCases',count(*) filter(where category='continuity'),
  'tieIdentityGuaranteed',false,
  'productionTriggerExecuted',false,
  'results',pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('label',label,'category',category,'details',details) order by category,label))
from issue234_audit_predecessor_semantics.results;
rollback;
