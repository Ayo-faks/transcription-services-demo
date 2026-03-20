# Staging Auth Domain Hardening

Final staging architecture:

- SPA: `https://scribe-staging.wulo.ai`
- Auth/API origin: `https://auth-staging.wulo.ai`
- Function App: `https://healthtranscript-staging-func-t6fmsx.azurewebsites.net`
- Static website origin: `https://healthtrant6fmsxdvweb.z33.web.core.windows.net`

Frontend runtime config must remain:

```js
window.APP_CONFIG.apiBaseUrl = 'https://auth-staging.wulo.ai/api';
window.APP_CONFIG.authBaseUrl = 'https://auth-staging.wulo.ai';
```

Cloudflare Worker goal:

- `scribe-staging.wulo.ai` serves only the SPA/static site.
- `scribe-staging.wulo.ai` does not proxy `/api/*` or `/.auth/*`.
- Google callback ownership stays on Azure Easy Auth at `auth-staging.wulo.ai`.

Deploy this Worker on `scribe-staging.wulo.ai`:

```js
export default {
  async fetch(request) {
    const targetUrl = new URL(request.url)
    targetUrl.protocol = 'https:'
    targetUrl.hostname = 'healthtrant6fmsxdvweb.z33.web.core.windows.net'
    targetUrl.port = ''

    return fetch(targetUrl.toString(), {
      method: request.method,
      headers: request.headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'manual',
    })
  },
}
```

Remove this old behavior from the Worker:

- Path splitting for `/api/*`
- Path splitting for `/.auth/*`
- Google `redirect_uri` rewrite to `scribe-staging.wulo.ai/.auth/login/google/callback`

Post-deploy validation:

1. `https://scribe-staging.wulo.ai/` loads the SPA.
2. `https://scribe-staging.wulo.ai/config.js` contains `auth-staging.wulo.ai` for both `apiBaseUrl` and `authBaseUrl`.
3. `https://auth-staging.wulo.ai/api/health` returns `200`.
4. `https://auth-staging.wulo.ai/.auth/me` returns `401` anonymously.
5. Starting login from the SPA navigates to `https://auth-staging.wulo.ai/.auth/login/google?...`.
6. Google OAuth `redirect_uri` is `https://auth-staging.wulo.ai/.auth/login/google/callback`.
7. After sign-in, the browser returns to `https://scribe-staging.wulo.ai/`.

Recommended Cloudflare cache purge after the Worker switch:

- `https://scribe-staging.wulo.ai/`
- `https://scribe-staging.wulo.ai/config.js`
