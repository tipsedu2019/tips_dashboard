import argparse
parser=argparse.ArgumentParser()
parser.add_argument('--container',default='tips_timetable_20260923_replay')
parser.add_argument('--prefix',default='task9')
args=parser.parse_args()
if not args.container.startswith('tips_timetable_') or not args.container.replace('_','').isalnum(): raise ValueError('isolated timetable container required')
if not args.prefix.replace('-','').isalnum(): raise ValueError('safe evidence prefix required')
from pathlib import Path
import subprocess,json,re
root=Path.cwd();out=root/'docs/qa/timetable-presets-20260923/evidence';results=[]
for p in sorted((root/'supabase/tests').glob('timetable*_test.sql')):
 r=subprocess.run(['/Users/hyunjun/.local/bin/docker','exec','-i',args.container,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'],input=p.read_text(),text=True,capture_output=True)
 log=r.stdout+r.stderr;(out/(args.prefix+'-clean-'+p.stem+'.tap')).write_text(log)
 plans=re.findall(r'^1\.\.(\d+)$',log,re.M);failed=re.findall(r'^not ok.*$',log,re.M);passed=len(re.findall(r'^ok \d+',log,re.M))
 result={'file':p.name,'exit':r.returncode,'plans':plans,'pass':passed,'failed':failed};results.append(result);print(json.dumps(result),flush=True)
(out/(args.prefix+'-clean-sql-results.json')).write_text(json.dumps(results,indent=2));
if any(row['exit'] or row['failed'] or not row['plans'] or sum(map(int,row['plans'])) != row['pass'] for row in results):
 raise SystemExit(1)
