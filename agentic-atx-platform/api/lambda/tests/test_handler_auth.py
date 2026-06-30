"""
Handler-level auth enforcement tests for async_invoke_agent.lambda_handler.

Ensures that when ENABLE_AUTH=true, EVERY HTTP entry path (submit, poll, direct,
and unknown actions) is rejected with 401 unless API Gateway-validated JWT claims
are present — i.e. there are no unauthenticated endpoints. Also verifies that
internal async self-invokes and CORS preflight are handled correctly.

boto3 is mocked so the handler imports without AWS access.

Run from agentic-atx-platform/api/lambda:
    python3 -m unittest discover -s tests -v
"""

import os
import sys
import json
import unittest
from unittest import mock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))


def _import_handler():
    """Import the handler with boto3 fully mocked."""
    boto3_mock = mock.MagicMock()
    with mock.patch.dict(sys.modules, {'boto3': boto3_mock}):
        # Fresh import each time so module-level boto3 clients are the mocks
        for mod in ('async_invoke_agent',):
            sys.modules.pop(mod, None)
        import async_invoke_agent
        return async_invoke_agent


def http_event(action='submit', extra=None, token=None, method='POST'):
    body = {'action': action}
    if action == 'submit':
        body['prompt'] = 'do something'
    if extra:
        body.update(extra)
    headers = {}
    if token is not None:
        headers['Authorization'] = f'Bearer {token}'
    return {'requestContext': {'http': {'method': method}}, 'headers': headers, 'body': json.dumps(body)}


HTTP_ACTIONS = ['submit', 'poll', 'direct', 'bogus-action']


class TestHandlerAuthEnabled(unittest.TestCase):
    def setUp(self):
        self.handler = _import_handler()

    def test_all_http_actions_rejected_without_token(self):
        # Auth on + no token => authorize() returns False => 401 for every action.
        with mock.patch.dict(os.environ, {'ENABLE_AUTH': 'true', 'COGNITO_USER_POOL_ID': 'p', 'COGNITO_APP_CLIENT_ID': 'c'}, clear=False):
            for action in HTTP_ACTIONS:
                ev = http_event(action=action, token=None)
                resp = self.handler.lambda_handler(ev, None)
                self.assertEqual(resp['statusCode'], 401,
                                 f"action={action} should be 401 without token, got {resp['statusCode']}")
                self.assertIn('Unauthorized', json.loads(resp['body'])['error'])

    def test_options_preflight_allowed_without_auth(self):
        with mock.patch.dict(os.environ, {'ENABLE_AUTH': 'true'}, clear=False):
            resp = self.handler.lambda_handler(http_event(method='OPTIONS', token=None), None)
            self.assertEqual(resp['statusCode'], 200)

    def test_internal_async_execute_bypasses_http_auth(self):
        with mock.patch.dict(os.environ, {'ENABLE_AUTH': 'true'}, clear=False):
            with mock.patch.object(self.handler, '_execute_agentcore', return_value={'ok': True}) as m:
                resp = self.handler.lambda_handler(
                    {'_async_execute': True, 'request_id': 'r1', 'prompt': 'p'}, None)
                m.assert_called_once()
                self.assertEqual(resp, {'ok': True})

    def test_valid_token_passes_auth_gate(self):
        # Mock the auth module the handler imports so a valid token passes the gate.
        with mock.patch.dict(os.environ, {'ENABLE_AUTH': 'true'}, clear=False):
            import auth as auth_mod
            with mock.patch.object(auth_mod, 'authorize', return_value=(True, None, {'sub': 'u'})), \
                 mock.patch.object(self.handler, '_handle_submit', return_value=self.handler.cors_response(200, '{"status":"SUBMITTED"}')) as m:
                ev = http_event(action='submit', token='good')
                resp = self.handler.lambda_handler(ev, None)
                m.assert_called_once()
                self.assertEqual(resp['statusCode'], 200)


class TestHandlerAuthDisabled(unittest.TestCase):
    def setUp(self):
        self.handler = _import_handler()

    def test_open_mode_does_not_require_token(self):
        with mock.patch.dict(os.environ, {'ENABLE_AUTH': 'false'}, clear=False):
            with mock.patch.object(self.handler, '_handle_submit', return_value=self.handler.cors_response(200, '{}')) as m:
                resp = self.handler.lambda_handler(http_event(action='submit', token=None), None)
                m.assert_called_once()
                self.assertEqual(resp['statusCode'], 200)


if __name__ == '__main__':
    unittest.main()
