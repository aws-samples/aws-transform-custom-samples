import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Return the scheme+host origin of a URL, or '' if it isn't an absolute URL.
// Strips any path (e.g. the API endpoint's "/prod"), which CSP source
// expressions must not include (a trailing path is treated as a path prefix).
function originOf(url) {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

// Build-time Content-Security-Policy injection.
//
// connect-src is scoped to the EXACT origins this build targets — the API Gateway
// endpoint and (when auth is enabled) the Cognito Hosted UI domain — instead of a
// broad wildcard like *.amazonaws.com. This tightens the anti-exfiltration boundary:
// even with script execution, the browser can only reach our own API + Cognito.
//
// The CSP replaces the <!--CSP_META--> placeholder in index.html at build time.
function cspPlugin(env) {
  return {
    name: 'inject-csp',
    transformIndexHtml(html) {
      const apiOrigin = originOf(env.VITE_API_ENDPOINT)
      const authEnabled = env.VITE_AUTH_ENABLED === 'true'
      const cognitoOrigin = authEnabled ? originOf(env.VITE_COGNITO_DOMAIN) : ''

      // 'self' covers the dev proxy (same-origin /api) and same-origin assets.
      const connectSrc = ["'self'", apiOrigin, cognitoOrigin].filter(Boolean).join(' ')

      const csp = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        `connect-src ${connectSrc}`,
        "base-uri 'self'",
        "object-src 'none'",
        // NOTE: frame-ancestors is intentionally omitted — browsers ignore it in a
        // <meta> CSP (it only works as an HTTP header). Clickjacking protection is
        // planned via a CloudFront response-headers policy (see docs/SECURITY.md).
      ].join('; ')

      const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}" />`
      return html.replace('<!--CSP_META-->', meta)
    },
  }
}

export default defineConfig(({ mode }) => {
  // Merge .env-file values with process.env so inline CLI env vars
  // (VITE_API_ENDPOINT=... npx vite build) and .env files both work.
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }

  return {
    plugins: [react(), cspPlugin(env)],
    server: {
      port: 3000,
      proxy: {
        '/api': {
          target: 'http://localhost:8080',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  }
})
