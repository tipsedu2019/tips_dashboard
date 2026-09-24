# -*- coding: utf-8 -*-
import subprocess,json,pathlib,argparse
parser=argparse.ArgumentParser()
parser.add_argument("--container",default="tips_timetable_20260923_replay")
parser.add_argument("--prefix",default="task9")
args=parser.parse_args()
if not args.container.startswith("tips_timetable_") or not args.container.replace("_","").isalnum(): raise ValueError("isolated timetable container required")
if not args.prefix.replace("-","").isalnum(): raise ValueError("safe evidence prefix required")
root=pathlib.Path.cwd();out=root/'docs/qa/timetable-presets-20260923/evidence'
def sql(container,q):
 r=subprocess.run(['/Users/hyunjun/.local/bin/docker','exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],input=q,text=True,capture_output=True,check=True);return r.stdout.strip()
q="""select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'identity',pg_get_function_identity_arguments(p.oid),'owner',pg_get_userbyid(p.proowner),'securityDefiner',p.prosecdef,'settings',p.proconfig,'acl',p.proacl::text,'md5',md5(pg_get_functiondef(p.oid)),'definition',pg_get_functiondef(p.oid)) order by n.nspname,p.proname),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','dashboard_private') and (p.proname like '%timetable%' or p.proname in ('initialize_new_class_schedule_v1','save_class_schedule_defaults_v1','update_class_operational_v1','close_class_atomic_v1','create_makeup_request_v2','approve_makeup_request_v2','reschedule_makeup_request_v2'));"""
(out/(args.prefix+'-final-definitions-acl.json')).write_text(json.dumps(json.loads(sql(args.container,q)),ensure_ascii=False,indent=2))
expected=json.loads((root/'docs/qa/timetable-presets-20260923/manual-fixture-preservation.json').read_text())['untouchedManualItems'];actual=[]
for i in expected:
 row=json.loads(sql('tips_timetable_20260923',"select jsonb_build_object('planId',i.plan_id,'itemId',i.id,'revision',i.revision,'slots',(select jsonb_agg(jsonb_build_object('weekday',weekday,'startMinute',start_minute,'endMinute',end_minute) order by weekday,start_minute) from public.timetable_plan_slots where item_id=i.id)) from public.timetable_plan_items i where i.id='"+i['itemId']+"'::uuid"));assert row==i,(row,i);actual.append(row)
(out/(args.prefix+'-manual-preservation.json')).write_text(json.dumps({'verifiedUnchanged':True,'items':actual},indent=2))
print('Final definitions/ACL captured; all 3 original manual item revisions and slots unchanged')
