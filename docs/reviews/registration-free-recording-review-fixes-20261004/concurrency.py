"""Bounded two-session checks on a disposable clone of the owned no-egress DB."""
from pathlib import Path
import json, os, subprocess, time

ROOT = Path(__file__).resolve().parents[3]
DOCKER = '/usr/local/bin/docker'
CONTAINER = 'supabase_db_tips_registration_free_20261004'
DATABASE = 'registration_free_concurrency_' + str(os.getpid())
ACTOR = '99410000-0000-4000-8000-000000000001'
inspection = json.loads(subprocess.check_output([DOCKER, 'inspect', CONTAINER]))[0]
networks = inspection['NetworkSettings']['Networks']
assert set(networks) == {'tips_registration_free_no_egress'}
network = json.loads(subprocess.check_output([DOCKER, 'network', 'inspect', 'tips_registration_free_no_egress']))[0]
assert network['Internal'] is True

def args():
    return [DOCKER, 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', DATABASE, '-XAt', '-v', 'ON_ERROR_STOP=1']

def run(sql):
    return subprocess.run(args(), input=sql, text=True, capture_output=True, timeout=30)

def check(sql):
    result = run(sql)
    assert result.returncode == 0, result.stderr
    return result.stdout

actor = "select set_config('request.jwt.claims','" + json.dumps({'sub': ACTOR, 'role': 'authenticated'}) + "',true); select set_config('request.jwt.claim.sub','" + ACTOR + "',true); set local role authenticated;\n"

def collide(label, first, second, expected_state=None):
    first_process = subprocess.Popen(args(), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    first_process.stdin.write('begin;\n' + actor + first + ";\nselect 'WINNER_READY';\nselect pg_sleep(1);\ncommit;\n")
    first_process.stdin.close()
    first_lines = []
    while True:
        line = first_process.stdout.readline()
        assert line, 'winner exited before holding its write lock: ' + first_process.stderr.read()
        first_lines.append(line.strip())
        if line.strip() == 'WINNER_READY':
            break
    started = time.monotonic()
    loser = run('\\set VERBOSITY verbose\nbegin;\n' + actor + second + ';\ncommit;\n')
    waited = time.monotonic() - started
    first_lines += first_process.stdout.read().splitlines()
    first_error = first_process.stderr.read()
    assert first_process.wait(timeout=10) == 0, first_error
    assert waited > 0.5, 'the second session did not actually overlap the held lock'
    if expected_state:
        assert loser.returncode != 0 and expected_state + ':' in loser.stderr, loser.stderr
    else:
        assert loser.returncode == 0, loser.stderr
        response = lambda lines: next(json.loads(line) for line in lines if line.startswith('{') and ('"operation"' in line or '"trackId"' in line))
        assert response(first_lines) == response(loser.stdout.splitlines()), 'concurrent replay response mismatch'
    return {'scenario': label, 'secondSessionWaitSeconds': round(waited, 3), 'secondSQLSTATE': expected_state, 'sameResponse': not expected_state}

def book(track, key):
    return f"select public.save_registration_observation_booking_v1('{track}',null,'99410000-0000-4000-8000-000000000103','normalized','99410000-0000-4000-8000-000000000104',null,null,null,null,'{key}')"

def status(track, target, revision, key):
    return f"select public.set_registration_workflow_status_v1('{track}','{target}',{revision},'{key}')"

results = []
try:
    maintenance_args = [DOCKER, 'exec', '-i', CONTAINER, 'psql', '-U', 'supabase_admin', '-d', 'template1', '-XAt', '-v', 'ON_ERROR_STOP=1']
    def maintenance(sql):
        result = subprocess.run(maintenance_args, input=sql, text=True, capture_output=True, timeout=10)
        assert result.returncode == 0, result.stderr
        return result.stdout.strip()
    # This owned DB has only pg_net/pg_cron workers. Refuse to interrupt any
    # reviewer/client session; pause new connections only during the clone.
    assert maintenance("select count(*) from pg_stat_activity where datname='postgres' and application_name not in ('pg_net 0.20.3','pg_cron scheduler')") == '0'
    try:
        maintenance('alter database postgres allow_connections false;')
        maintenance("select pg_terminate_backend(pid) from pg_stat_activity where datname='postgres' and application_name in ('pg_net 0.20.3','pg_cron scheduler');")
        maintenance('create database ' + DATABASE + ' with template postgres owner postgres;')
    finally:
        maintenance('alter database postgres allow_connections true;')
    fixture = (ROOT / 'supabase/tests/registration_observation_status_independence_test.sql').read_text().split('select function_returns(', 1)[0].replace('select plan(27);', '')
    check(fixture + '\ncommit;')
    first_track = '99410000-0000-4000-8000-000000000116'
    second_track = '99410000-0000-4000-8000-000000000106'
    results.append(collide('same track, different booking keys', book(first_track, 'concurrent-book-a'), book(first_track, 'concurrent-book-b'), '55000'))
    results.append(collide('same booking key concurrent replay', book(second_track, 'concurrent-book-shared'), book(second_track, 'concurrent-book-shared')))
    results.append(collide('different status keys, same revision', status(first_track, 'inquiry', 12, 'status-a'), status(first_track, 'waiting_new_class', 12, 'status-b'), '23514'))
    results.append(collide('same status key concurrent replay', status(second_track, 'observation_requested', 9, 'status-shared'), status(second_track, 'observation_requested', 9, 'status-shared')))
    counts = json.loads(check("select json_build_object('scheduled', (select count(*) from public.ops_registration_observations where track_id in ('" + first_track + "','" + second_track + "') and status='scheduled'), 'bookingReceipts', (select count(*) from dashboard_private.registration_observation_mutation_requests where request_key like 'concurrent-book%'), 'statusReceipts', (select count(*) from dashboard_private.ops_registration_mutations where request_key like 'status-%'), 'revisions', (select json_agg(workflow_revision order by id) from public.ops_registration_subject_tracks where id in ('" + first_track + "','" + second_track + "')))").strip())
    assert counts == {'scheduled': 2, 'bookingReceipts': 2, 'statusReceipts': 2, 'revisions': [10, 13]}, counts
    print(json.dumps({'scenarios': results, 'counts': counts, 'providerCalls': 0, 'disposableDatabaseDropped': True}, indent=2))
finally:
    subprocess.run([DOCKER, 'exec', CONTAINER, 'dropdb', '-U', 'postgres', '--if-exists', DATABASE], check=True, capture_output=True)
