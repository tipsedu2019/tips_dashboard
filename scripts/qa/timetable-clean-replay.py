# Reproducible PostgreSQL-only replay; refuses any existing container of this name.
import json,subprocess,pathlib,sys,time
root=pathlib.Path.cwd();base=root/'docs/qa/timetable-presets-20260923/evidence';base.mkdir(exist_ok=True)
docker='/Users/hyunjun/.local/bin/docker';name='tips_timetable_20260923_replay'
if subprocess.run([docker,'inspect',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:raise RuntimeError('Replay container already exists; refusing reset')
subprocess.run([docker,'run','-d','--network','none','--name',name,'-e','POSTGRES_PASSWORD=local_fixture_only','-e','PGDATA=/var/lib/postgresql/data','public.ecr.aws/supabase/postgres:17.6.1.159','postgres','-D','/var/lib/postgresql/data','-c','listen_addresses=','-c','shared_preload_libraries=pg_cron,pg_net','-c','cron.database_name=postgres'],check=True)
for _ in range(100):
 logs=subprocess.run([docker,'logs',name],capture_output=True,text=True)
 if 'PostgreSQL init process complete' in logs.stdout+logs.stderr and subprocess.run([docker,'exec',name,'pg_isready','-U','postgres'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:break
 time.sleep(.2)
else:raise RuntimeError('init timeout')
prereqs=b"""create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists pgtap with schema extensions;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
alter table auth.users add column if not exists deleted_at timestamptz, add column if not exists banned_until timestamptz, add column if not exists email_confirmed_at timestamptz;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key,bucket_id text references storage.buckets(id));
alter table storage.objects enable row level security;
alter table storage.buckets owner to postgres;
alter table storage.objects owner to postgres;
"""
manifest=json.loads((root/'supabase/test-baselines/dashboard-free-tier-v1.manifest.json').read_text())
files=['supabase/test-baselines/dashboard-free-tier-v1.sql','scripts/fixtures/dashboard-free-tier-isolated-schema-repair.sql','scripts/fixtures/dashboard-free-tier-migration-prerequisites.sql','scripts/fixtures/dashboard-free-tier-notification-settings-prerequisites.sql']+['supabase/migrations/'+s for s in ['20260803142000_notification_word_retest_content_payload.sql','20260803144000_notification_transfer_content_payload.sql','20260803145000_notification_withdrawal_content_payload.sql']]+['supabase/migrations/'+i['fileName'] for i in manifest['orderedNewMigrations']]
with (base/'task9-clean-replay.log').open('w') as log:
 def apply(data,user='postgres'):
  return subprocess.run([docker,'exec','-i',name,'psql','-U',user,'-d','postgres','-X','-v','ON_ERROR_STOP=1'],input=data,stdout=log,stderr=subprocess.STDOUT)
 r=apply(prereqs,'supabase_admin')
 if r.returncode:sys.exit(r.returncode)
 for i,f in enumerate(files):
  log.write('\nAPPLY '+f+'\n');log.flush()
  r=apply((root/f).read_bytes())
  if r.returncode:
   print('FAILED',i+1,len(files),f); print((base/'task9-clean-replay.log').read_text()[-2200:]);sys.exit(r.returncode)
 # Exact obsolete-trigger/legacy ACL reconciliation already present in origin. No old function definitions replayed.
 r=apply(b'''drop trigger if exists reconcile_makeup_notification_settings_after_write_v1 on public.makeup_notification_settings; revoke insert, update, delete on public.makeup_notification_settings from authenticated; drop policy if exists makeup_notification_settings_staff_write on public.makeup_notification_settings; revoke all on function public.reconcile_makeup_notification_settings_after_write_v1() from public,anon,authenticated,service_role;''')
 if r.returncode:sys.exit(r.returncode)
 print('PASS baseline + prerequisites +',len(manifest['orderedNewMigrations']),'ordered migrations')
