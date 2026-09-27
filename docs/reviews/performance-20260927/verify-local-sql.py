"""Run only against the explicitly named, isolated local QA Docker container."""
import json, pathlib, re, subprocess, sys
root = pathlib.Path(__file__).resolve().parents[3]
container = sys.argv[1]
info = json.loads(subprocess.check_output(['docker','inspect',container],text=True))[0]
assert info['HostConfig']['NetworkMode'] == 'none', 'Requires network-isolated QA container'
tests = ['performance_catalog_taxonomy_test.sql','textbook_inventory_numbered_reads_test.sql','dashboard_workload_test.sql','timetable_makeup_domain_sqlstate_test.sql','timetable_operational_conflicts_test.sql']
results = []
for file in tests:
    user = 'supabase_admin' if file == 'dashboard_workload_test.sql' else 'postgres'
    result = subprocess.run(['docker','exec','-i',container,'psql','-U',user,'-d','postgres','-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],input=(root/'supabase/tests'/file).read_text(),text=True,capture_output=True)
    output = result.stdout + result.stderr
    (pathlib.Path(__file__).parent/(file.removesuffix('_test.sql')+'.tap')).write_text(output)
    failed = re.findall(r'^not ok.*$',output,re.M)
    passed = len(re.findall(r'^ok \d+',output,re.M))
    plans = re.findall(r'^1\.\.(\d+)\s*$',output,re.M)
    assert result.returncode == 0 and not failed and plans == [str(passed)], (file,result.returncode,failed,output[-2000:])
    results.append(dict(file=file,exit=result.returncode,plans=plans,passed=passed,failed=failed))
(pathlib.Path(__file__).parent/'sql-results.json').write_text(json.dumps(results,indent=2)+'\n')
print(f'{sum(r["passed"] for r in results)} assertions passed across {len(results)} SQL suites')
