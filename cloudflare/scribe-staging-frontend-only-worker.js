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