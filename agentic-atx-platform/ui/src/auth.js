// UI auth helper for the agentic ATX platform.
//
// When VITE_AUTH_ENABLED=true, the app authenticates against a Cognito User Pool
// using the Hosted UI (OAuth2 authorization-code + PKCE) and attaches the access
// token as `Authorization: Bearer <token>` to every API call via authedFetch().
// When the flag is off (default for the blog/demo build), authedFetch behaves like
// plain fetch and no login is required.
//
// Build-time config (Vite env):
//   VITE_AUTH_ENABLED      "true" to turn on auth
//   VITE_COGNITO_DOMAIN    e.g. https://atx-transform-<acct>.auth.us-east-1.amazoncognito.com
//   VITE_COGNITO_CLIENT_ID Cognito app client id
//   VITE_AUTH_REDIRECT_URI defaults to window.location.origin

const AUTH_ENABLED = (import.meta.env.VITE_AUTH_ENABLED ?? 'false') === 'true'
const COGNITO_DOMAIN = (import.meta.env.VITE_COGNITO_DOMAIN || '').replace(/\/$/, '')
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID || ''
const REDIRECT_URI = import.meta.env.VITE_AUTH_REDIRECT_URI || (typeof window !== 'undefined' ? window.location.origin : '')

const TOKEN_KEY = 'atx_access_token'
const TOKEN_EXP_KEY = 'atx_access_token_exp'
const PKCE_VERIFIER_KEY = 'atx_pkce_verifier'

export function authEnabled() {
  return AUTH_ENABLED
}

// ---- PKCE helpers ----

function base64UrlEncode(bytes) {
  let str = ''
  const arr = new Uint8Array(bytes)
  for (let i = 0; i < arr.length; i++) str += String.fromCharCode(arr[i])
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256(input) {
  const data = new TextEncoder().encode(input)
  return crypto.subtle.digest('SHA-256', data)
}

function randomString(len = 64) {
  const arr = new Uint8Array(len)
  crypto.getRandomValues(arr)
  return base64UrlEncode(arr).slice(0, len)
}

// ---- Token storage ----

function storeToken(accessToken, expiresInSec) {
  sessionStorage.setItem(TOKEN_KEY, accessToken)
  sessionStorage.setItem(TOKEN_EXP_KEY, String(Date.now() + (expiresInSec - 30) * 1000))
}

export function getToken() {
  const token = sessionStorage.getItem(TOKEN_KEY)
  const exp = Number(sessionStorage.getItem(TOKEN_EXP_KEY) || 0)
  if (!token || Date.now() > exp) return null
  return token
}

export function isAuthenticated() {
  return !AUTH_ENABLED || !!getToken()
}

export function logout() {
  sessionStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(TOKEN_EXP_KEY)
  if (AUTH_ENABLED && COGNITO_DOMAIN) {
    const url = `${COGNITO_DOMAIN}/logout?client_id=${encodeURIComponent(CLIENT_ID)}&logout_uri=${encodeURIComponent(REDIRECT_URI)}`
    window.location.assign(url)
  }
}

// ---- Login (Hosted UI, authorization code + PKCE) ----

export async function login() {
  if (!AUTH_ENABLED) return
  const verifier = randomString(64)
  const challenge = base64UrlEncode(await sha256(verifier))
  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier)
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    scope: 'openid email profile',
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  })
  window.location.assign(`${COGNITO_DOMAIN}/oauth2/authorize?${params.toString()}`)
}

// Exchange the ?code=... returned by the Hosted UI for tokens. Call once on app load.
// Returns true if a code was present and exchanged.
export async function handleAuthRedirect() {
  if (!AUTH_ENABLED) return false
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  if (!code) return false

  const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY) || ''
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  })
  try {
    const res = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    if (!res.ok) throw new Error(`token exchange failed: ${res.status}`)
    const data = await res.json()
    if (data.access_token) storeToken(data.access_token, data.expires_in || 3600)
  } finally {
    sessionStorage.removeItem(PKCE_VERIFIER_KEY)
    // Clean the ?code= from the URL so a refresh doesn't re-trigger exchange.
    url.searchParams.delete('code')
    url.searchParams.delete('state')
    window.history.replaceState({}, document.title, url.pathname + url.search)
  }
  return true
}

// ---- Authenticated fetch wrapper ----

// Drop-in for fetch(). When auth is enabled, attaches the bearer token and, on a
// 401 or missing token, redirects to the Hosted UI login.
export async function authedFetch(input, init = {}) {
  if (!AUTH_ENABLED) return fetch(input, init)

  const token = getToken()
  if (!token) {
    await login()
    // login() navigates away; return a never-resolving promise to avoid downstream work.
    return new Promise(() => {})
  }
  const headers = { ...(init.headers || {}), Authorization: `Bearer ${token}` }
  const res = await fetch(input, { ...init, headers })
  if (res.status === 401) {
    logout()
    await login()
    return new Promise(() => {})
  }
  return res
}
