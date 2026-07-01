"""
Tests for auth enforcement on the async invoke Lambda.

Run from agentic-atx-platform/api/lambda:
    python3 -m unittest discover -s tests -v

Covers:
  - auth disabled (open/demo mode) lets requests through
  - auth enabled rejects requests with no bearer token (401)
  - auth enabled rejects when JWT verification fails (bad signature/expired)
  - auth enabled accepts a valid token and returns its claims
  - token_use / client_id mismatches are rejected
  - misconfiguration (no pool/client) fails closed
  - internal async self-invokes bypass HTTP auth
"""

import os
import sys
import json
import unittest
from unittest import mock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import auth  # noqa: E402

POOL_ENV = {
    'ENABLE_AUTH': 'true',
    'COGNITO_USER_POOL_ID': 'us-east-1_pool',
    'COGNITO_APP_CLIENT_ID': 'client123',
    'EXPECTED_TOKEN_USE': 'access',
    'AWS_REGION': 'us-east-1',
}


def http_event(token=None, body=None, method='POST'):
    headers = {}
    if token is not None:
        headers['Authorization'] = f'Bearer {token}'
    return {
        'requestContext': {'http': {'method': method}},
        'headers': headers,
        'body': json.dumps(body or {'action': 'direct', 'op': 'list_jobs'}),
    }


class TestAuthDisabled(unittest.TestCase):
    def test_disabled_is_open(self):
        with mock.patch.dict(os.environ, {'ENABLE_AUTH': 'false'}, clear=False):
            ok, err, claims = auth.authorize(http_event())
            self.assertTrue(ok)
            self.assertIsNone(err)

    def test_disabled_variants(self):
        for val in ('', 'False', 'no', '0', 'FALSE'):
            with mock.patch.dict(os.environ, {'ENABLE_AUTH': val}, clear=False):
                self.assertFalse(auth.auth_enabled(), f"{val!r} should be disabled")


class TestAuthEnabled(unittest.TestCase):
    def test_missing_token_rejected(self):
        with mock.patch.dict(os.environ, POOL_ENV, clear=False):
            ok, err, _ = auth.authorize(http_event(token=None))
            self.assertFalse(ok)
            self.assertIn('missing bearer token', err)

    def test_unconfigured_fails_closed(self):
        env = dict(POOL_ENV)
        env['COGNITO_USER_POOL_ID'] = ''
        with mock.patch.dict(os.environ, env, clear=False):
            ok, err, _ = auth.authorize(http_event(token='x'))
            self.assertFalse(ok)
            self.assertIn('not configured', err)

    def test_invalid_token_rejected(self):
        with mock.patch.dict(os.environ, POOL_ENV, clear=False):
            with mock.patch.object(auth, '_get_jwk_client') as gk:
                gk.return_value.get_signing_key_from_jwt.side_effect = Exception('bad key')
                ok, err, _ = auth.authorize(http_event(token='tampered'))
                self.assertFalse(ok)
                self.assertIn('Unauthorized', err)

    def test_valid_access_token_accepted(self):
        with mock.patch.dict(os.environ, POOL_ENV, clear=False):
            with mock.patch.object(auth, '_get_jwk_client') as gk, \
                 mock.patch.object(auth, 'jwt') as jwtmod:
                gk.return_value.get_signing_key_from_jwt.return_value = mock.Mock(key='K')
                jwtmod.decode.return_value = {'sub': 'u1', 'token_use': 'access', 'client_id': 'client123'}
                ok, err, claims = auth.authorize(http_event(token='good'))
                self.assertTrue(ok, err)
                self.assertEqual(claims['sub'], 'u1')

    def test_wrong_token_use_rejected(self):
        with mock.patch.dict(os.environ, POOL_ENV, clear=False):
            with mock.patch.object(auth, '_get_jwk_client') as gk, \
                 mock.patch.object(auth, 'jwt') as jwtmod:
                gk.return_value.get_signing_key_from_jwt.return_value = mock.Mock(key='K')
                jwtmod.decode.return_value = {'sub': 'u1', 'token_use': 'id'}
                ok, err, _ = auth.authorize(http_event(token='good'))
                self.assertFalse(ok)
                self.assertIn('token_use', err)

    def test_client_id_mismatch_rejected(self):
        with mock.patch.dict(os.environ, POOL_ENV, clear=False):
            with mock.patch.object(auth, '_get_jwk_client') as gk, \
                 mock.patch.object(auth, 'jwt') as jwtmod:
                gk.return_value.get_signing_key_from_jwt.return_value = mock.Mock(key='K')
                jwtmod.decode.return_value = {'sub': 'u1', 'token_use': 'access', 'client_id': 'someoneelse'}
                ok, err, _ = auth.authorize(http_event(token='good'))
                self.assertFalse(ok)
                self.assertIn('client_id', err)


class TestGatewayClaims(unittest.TestCase):
    def test_gateway_validated_claims_trusted(self):
        # When the API Gateway JWT authorizer has validated and attached claims,
        # authorize() trusts them without re-verifying the token.
        with mock.patch.dict(os.environ, POOL_ENV, clear=False):
            ev = {
                'requestContext': {'http': {'method': 'POST'},
                                   'authorizer': {'jwt': {'claims': {'sub': 'gw-user', 'token_use': 'access'}}}},
                'headers': {},
                'body': '{}',
            }
            ok, err, claims = auth.authorize(ev)
            self.assertTrue(ok, err)
            self.assertEqual(claims['sub'], 'gw-user')


class TestBearerExtraction(unittest.TestCase):
    def test_case_insensitive_header(self):
        ev = {'headers': {'authorization': 'Bearer abc'}}
        self.assertEqual(auth._bearer_token(ev), 'abc')

    def test_raw_token_without_prefix(self):
        ev = {'headers': {'Authorization': 'abc'}}
        self.assertEqual(auth._bearer_token(ev), 'abc')

    def test_no_header(self):
        self.assertEqual(auth._bearer_token({'headers': {}}), '')


class TestInternalInvoke(unittest.TestCase):
    def test_internal_invoke_detection(self):
        self.assertTrue(auth.is_internal_invoke({'_async_execute': True}))
        self.assertTrue(auth.is_internal_invoke({'_async_download': True}))
        self.assertFalse(auth.is_internal_invoke(http_event()))


if __name__ == '__main__':
    unittest.main()
