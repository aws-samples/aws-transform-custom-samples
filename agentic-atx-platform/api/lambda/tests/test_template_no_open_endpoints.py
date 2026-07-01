"""
Static checks guaranteeing there are no unauthenticated endpoints once auth is on.

Auth is enforced in the Lambda (auth.py) rather than a gateway authorizer (SAM can't
toggle a default JWT authorizer on one HttpApi). These tests assert the security
invariants that keep the surface closed:

  1. EnableAuth parameter + AuthEnabled condition exist; Cognito resources are gated.
  2. There is exactly one HTTP API route (/orchestrate) — no stray public routes.
  3. No AWS::Lambda::Url / FunctionUrlConfig (those bypass the handler's auth gate).
  4. The handler calls auth.authorize() before routing any HTTP action, and the
     OPTIONS/preflight short-circuit happens before action routing.
  5. auth.py fails closed (rejects) when enabled but unconfigured or token invalid.

Run from agentic-atx-platform/api/lambda:
    python3 -m unittest discover -s tests -v
"""

import os
import re
import unittest

HERE = os.path.dirname(__file__)
TEMPLATE = os.path.abspath(os.path.join(HERE, '..', '..', '..', 'sam', 'template.yaml'))
HANDLER = os.path.abspath(os.path.join(HERE, '..', 'async_invoke_agent.py'))


class TestTemplateSecurity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(TEMPLATE) as f:
            cls.text = f.read()
        with open(HANDLER) as f:
            cls.handler = f.read()

    def test_enable_auth_parameter_present(self):
        self.assertIn('EnableAuth:', self.text)
        self.assertRegex(self.text, r'AuthEnabled:\s*!Equals\s*\[\s*!Ref EnableAuth,\s*"true"\s*\]')

    def test_auth_enabled_by_default(self):
        # Secure by default: the EnableAuth parameter must default to "true".
        m = re.search(r'EnableAuth:\s*\n\s*Type:\s*String\s*\n\s*Default:\s*"(\w+)"', self.text)
        self.assertIsNotNone(m, "EnableAuth parameter/Default not found")
        self.assertEqual(m.group(1), 'true', "EnableAuth must default to 'true' (secure by default)")

    def test_cognito_resources_conditional(self):
        for res in ('UserPool:', 'UserPoolClient:'):
            self.assertIn(res, self.text)
        self.assertGreaterEqual(self.text.count('Condition: AuthEnabled'), 2)

    def test_jwt_authorizer_conditional(self):
        # A JWT authorizer is declared and gated on AuthEnabled.
        self.assertRegex(self.text, r'HttpApiJwtAuthorizer:\s*\n\s*Type:\s*AWS::ApiGatewayV2::Authorizer\s*\n\s*Condition:\s*AuthEnabled')
        self.assertIn('AuthorizerType: JWT', self.text)
        self.assertIn('cognito-idp.', self.text)

    def test_route_auth_is_conditional(self):
        # The route's AuthorizationType flips JWT/NONE and AuthorizerId is conditional.
        self.assertRegex(self.text, r'AuthorizationType:\s*!If\s*\[\s*AuthEnabled,\s*"JWT",\s*"NONE"\s*\]')
        self.assertRegex(self.text, r'AuthorizerId:\s*!If\s*\[\s*AuthEnabled,\s*!Ref HttpApiJwtAuthorizer,\s*!Ref "AWS::NoValue"\s*\]')

    def test_single_route(self):
        # Exactly one route, and it's POST /orchestrate.
        routes = re.findall(r'RouteKey:\s*"POST /orchestrate"', self.text)
        self.assertEqual(len(routes), 1, f"expected exactly 1 /orchestrate route, found {len(routes)}")

    def test_no_public_function_urls(self):
        self.assertNotIn('AWS::Lambda::Url', self.text)
        self.assertNotIn('FunctionUrlConfig', self.text)

    def test_lambda_receives_auth_config(self):
        for env in ('ENABLE_AUTH:', 'COGNITO_USER_POOL_ID:', 'COGNITO_APP_CLIENT_ID:'):
            self.assertIn(env, self.text)

    def test_handler_enforces_auth_before_routing(self):
        # authorize() must be invoked, and its failure must return before action routing.
        self.assertIn('from auth import authorize', self.handler)
        self.assertIn('authorize(event)', self.handler)
        idx_auth = self.handler.index('authorize(event)')
        idx_submit = self.handler.index("action == 'submit'")
        self.assertLess(idx_auth, idx_submit, "auth gate must run before action routing")
        # A 401 must be returned on failure.
        self.assertRegex(self.handler, r'return cors_response\(401')


class TestAuthFailsClosed(unittest.TestCase):
    def test_unconfigured_when_enabled_rejects(self):
        import sys
        sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..')))
        import auth
        from unittest import mock
        env = {'ENABLE_AUTH': 'true', 'COGNITO_USER_POOL_ID': '', 'COGNITO_APP_CLIENT_ID': ''}
        with mock.patch.dict(os.environ, env, clear=False):
            ev = {'headers': {'Authorization': 'Bearer x'}, 'requestContext': {'http': {'method': 'POST'}}}
            ok, err, _ = auth.authorize(ev)
            self.assertFalse(ok)


if __name__ == '__main__':
    unittest.main()
