"""Independent server-contract probes; no live credential or transport."""
import contextlib, importlib.machinery, importlib.util, io, json, os
from pathlib import Path
import tempfile, unittest, sys
import urllib.error
CLIENT = Path(os.environ['TIPS_REVIEW_CLIENT'])
KEY = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
CID = '11111111-2222-4333-8444-555555555555'
TOKEN = 'synthetic-preview-token'
HASH = 'a' * 64
SLOTS = [dict(id='slot-1', weekday=1, startMinute=540, endMinute=600, teacherId='t1', classroomId='r1')]

class Response:

    def __init__(self, body):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        if isinstance(self.body, BaseException):
            raise self.body
        return self.body if isinstance(self.body, bytes) else json.dumps(self.body).encode()

class ContractTests(unittest.TestCase):

    def setUp(self):
        loader = importlib.machinery.SourceFileLoader('review_client', str(CLIENT))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        self.cli = importlib.util.module_from_spec(spec)
        loader.exec_module(self.cli)
        self.cli.add_surrogate_to_request = lambda *a, **k: None
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.calls = []
        self.result = None
        outer = self

        class Opener:

            def open(self, req, timeout=None):
                outer.calls.append((req.get_method(), req.full_url))
                if req.full_url.endswith('/health'):
                    return Response({'data': {'credentialId': 'synthetic-credential', 'apiVersion': outer.version, 'scopes': ['classes:read', 'class-details:read', 'class-info:write']}})
                if req.full_url.endswith('/preview'):
                    return Response({'data': {'previewToken': TOKEN, 'expiresAt': '2035-01-01T00:00:00Z', 'before': {'id': CID}, 'after': {'id': CID, 'weeklySlots': SLOTS, 'verificationHash': HASH}}})
                return Response(outer.result)
        original_opener = self.cli.urllib.request.build_opener
        self.addCleanup(setattr, self.cli.urllib.request, 'build_opener', original_opener)
        self.cli.urllib.request.build_opener = lambda *a: Opener()

    def call(self, version, args, origin='https://api.example.test'):
        self.version = version
        (out, err) = (io.StringIO(), io.StringIO())
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                self.cli.main(['--base-url', origin + '/api/v' + version, '--allowed-hosts', 'api.example.test', '--journal', self.tmp.name] + args)
            except SystemExit as e:
                return (e.code, out.getvalue(), err.getvalue())
        return (0, out.getvalue(), err.getvalue())

    def commit(self, v):
        return self.call(v, ['operations', 'commit', '--preview-token', TOKEN, '--idempotency-key', KEY])

    def get(self, v):
        return self.call(v, ['operations', 'get', '--request-key', KEY])

    def applied(self):
        return {'data': {'operationId': KEY, 'state': 'applied', 'class': {'id': CID, 'weeklySlots': SLOTS, 'verificationHash': HASH}}}

    def seed_preview(self, v, origin='https://api.example.test'):
        args = ['classes', 'weekly-time', 'preview', '--id', CID, '--slot-id', 'slot-1', '--start-minute', '540', '--end-minute', '600', '--expected-version', HASH, '--reason', 'synthetic'] if v == '1' else ['changes', 'preview', '--class-id', CID, '--from', '2035-01-01', '--to', '2035-01-31', '--expected-version', HASH, '--reason', 'synthetic', '--basic-json', '{"name":"Synthetic"}']
        self.assertEqual(self.call(v, args, origin)[0], 0)

    def test_real_failed_receipt_post_and_get(self):
        for v in ('1', '2'):
            with self.subTest(version=v):
                self.result = {'data': {'operationId': KEY, 'state': 'failed', 'error': {'code': 'agent_stale', 'sqlstate': 'P0001'}}}
                self.assertEqual(self.commit(v)[0], 3)
                self.assertEqual(self.get(v)[0], 3)

    def test_real_unknown_receipt(self):
        for v in ('1', '2'):
            with self.subTest(version=v):
                self.result = {'data': {'operationId': KEY, 'state': 'unknown', 'retryWithNewKey': False}}
                self.assertEqual(self.commit(v)[0], 4)
                self.assertEqual(self.get(v)[0], 4)

    def test_unrecognized_state_is_never_success(self):
        for v in ('1', '2'):
            with self.subTest(version=v):
                self.result = self.applied()
                self.result['data']['state'] = 'unexpected'
                self.assertEqual(self.get(v)[0], 4)

    def test_success_status_malformed_body_is_unconfirmed(self):
        for v in ('1', '2'):
            for raw in (b'<html>PRIVATE-RESPONSE</html>', b'{broken', b'\xff', [], None, {'data': []}, {'data': 'wrong'}):
                with self.subTest(version=v, body=repr(raw)):
                    self.result = raw
                    (code, out, err) = self.get(v)
                    self.assertEqual(code, 4)
                    self.assertNotIn('PRIVATE-RESPONSE', out + err)

    def test_response_timeout_is_unconfirmed(self):
        for v in ('1', '2'):
            with self.subTest(version=v):
                self.result = TimeoutError('read timeout')
                self.assertEqual(self.commit(v)[0], 4)

    def test_malformed_http_error_envelope_is_unconfirmed(self):
        for v in ('1', '2'):
            for body in ([], None, {'error': 'wrong'}, {'data': ['wrong']}):
                with self.subTest(version=v, body=body):
                    self.result = urllib.error.HTTPError(
                        'https://api.example.test/operations', 503, 'unavailable',
                        {}, io.BytesIO(json.dumps(body).encode()))
                    self.assertEqual(self.get(v)[0], 4)

    def test_invalid_base_url_is_rejected_before_any_request(self):
        for origin in ('https://user@api.example.test',
                       'https://api.example.test?query=1',
                       'https://api.example.test#fragment',
                       'https://api.example.test:invalid',
                       'https://api.example.test:0'):
            with self.subTest(origin=origin):
                self.calls.clear()
                self.assertEqual(self.call('2', ['health'], origin)[0], 2)
                self.assertEqual(self.calls, [])

    def test_explicit_existing_key_looks_up_without_post(self):
        for v in ('1', '2'):
            with self.subTest(version=v):
                self.seed_preview(v)
                self.result = self.applied()
                self.assertEqual(self.commit(v)[0], 0)
                self.calls.clear()
                self.assertEqual(self.commit(v)[0], 0)
                self.assertFalse(any((method == 'POST' for (method, url) in self.calls)))
                self.assertTrue(any((url.endswith('/operations/' + KEY) for (method, url) in self.calls)))

    def test_corrupt_journal_blocks_post(self):
        self.seed_preview('2')
        journal = next(Path(self.tmp.name).rglob('operations.jsonl'))
        with journal.open('a') as f:
            f.write('{truncated commit\n')
        self.result = self.applied()
        self.calls.clear()
        self.assertEqual(self.commit('2')[0], 4)
        self.assertFalse(any((method == 'POST' for (method, url) in self.calls)))

    def test_origin_port_isolation(self):
        self.seed_preview('2', 'https://api.example.test')
        first = set(Path(self.tmp.name).rglob('operations.jsonl'))
        self.seed_preview('2', 'https://api.example.test:8443')
        self.assertEqual(len(set(Path(self.tmp.name).rglob('operations.jsonl')) - first), 1)
if __name__ == '__main__':
    unittest.main(verbosity=2)
