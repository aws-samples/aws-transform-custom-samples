"""
Auth enforcement for the async invoke Lambda.

Authentication is enforced here (not at the API Gateway) so a single EnableAuth
toggle controls it cleanly — SAM cannot conditionally attach/detach a default JWT
authorizer on one HTTP API. When ENABLE_AUTH=true, every HTTP request must carry a
valid Cognito JWT in the Authorization header; the token is cryptographically
verified (signature via the user pool JWKS, plus issuer/audience/expiry) before any
action runs. When ENABLE_AUTH!=true the API is open (blog/demo mode).

Verification uses PyJWT. The JWKS is fetched once per cold start and cached.
"""

import os
import json
import time
import urllib.request

try:
    import jwt
    from jwt import PyJWKClient
    _JWT_AVAILABLE = True
except Exception:  # pragma: no cover - import guard
    _JWT_AVAILABLE = False

REGION = os.environ.get('AWS_REGION', os.environ.get('AWS_DEFAULT_REGION', 'us-east-1'))

_jwk_client = None
_jwk_client_url = None


def auth_enabled() -> bool:
    return os.environ.get('ENABLE_AUTH', 'false').strip().lower() == 'true'


def is_internal_invoke(event) -> bool:
    """Internal async self-invokes (InvocationType=Event) bypass HTTP auth."""
    return bool(event.get('_async_execute') or event.get('_async_download'))


def _issuer() -> str:
    pool_id = os.environ.get('COGNITO_USER_POOL_ID', '')
    return f"https://cognito-idp.{REGION}.amazonaws.com/{pool_id}"


def _jwks_url() -> str:
    return f"{_issuer()}/.well-known/jwks.json"


def _get_jwk_client():
    global _jwk_client, _jwk_client_url
    url = _jwks_url()
    if _jwk_client is None or _jwk_client_url != url:
        _jwk_client = PyJWKClient(url)
        _jwk_client_url = url
    return _jwk_client


def _bearer_token(event) -> str:
    """Extract the bearer token from the Authorization header (case-insensitive)."""
    headers = event.get('headers') or {}
    auth_header = ''
    for k, v in headers.items():
        if k and k.lower() == 'authorization':
            auth_header = v or ''
            break
    if not auth_header:
        return ''
    parts = auth_header.split()
    if len(parts) == 2 and parts[0].lower() == 'bearer':
        return parts[1]
    # Some clients send the raw token without the Bearer prefix.
    return auth_header.strip()


def authorize(event):
    """
    Returns (ok: bool, error: str|None, claims: dict).

    - Auth disabled              -> (True, None, {})            [open mode]
    - Auth enabled + valid token -> (True, None, <claims>)
    - Auth enabled + bad/missing -> (False, reason, {})
    """
    if not auth_enabled():
        return True, None, {}

    if not _JWT_AVAILABLE:
        # Fail closed: if the crypto library is missing while auth is on, do not serve.
        return False, 'Unauthorized: auth library unavailable', {}

    pool_id = os.environ.get('COGNITO_USER_POOL_ID', '')
    app_client_id = os.environ.get('COGNITO_APP_CLIENT_ID', '')
    if not pool_id or not app_client_id:
        return False, 'Unauthorized: auth not configured', {}

    token = _bearer_token(event)
    if not token:
        return False, 'Unauthorized: missing bearer token', {}

    try:
        signing_key = _get_jwk_client().get_signing_key_from_jwt(token)
        expected_use = os.environ.get('EXPECTED_TOKEN_USE', 'access').strip().lower()
        # Access tokens do not carry an `aud` claim (they use client_id); id tokens do.
        # Verify audience only for id tokens; always verify issuer + signature + expiry.
        decode_kwargs = {
            'algorithms': ['RS256'],
            'issuer': _issuer(),
            'options': {'require': ['exp', 'iat']},
        }
        if expected_use == 'id':
            decode_kwargs['audience'] = app_client_id
        claims = jwt.decode(token, signing_key.key, **decode_kwargs)

        token_use = str(claims.get('token_use', '')).lower()
        if expected_use and token_use and token_use != expected_use:
            return False, f'Unauthorized: unexpected token_use "{token_use}"', {}

        # For access tokens, validate the client_id claim matches our app client.
        if token_use == 'access':
            if claims.get('client_id') and claims['client_id'] != app_client_id:
                return False, 'Unauthorized: token client_id mismatch', {}

        return True, None, claims

    except Exception as e:  # invalid signature, expired, wrong issuer, etc.
        return False, f'Unauthorized: {type(e).__name__}', {}
