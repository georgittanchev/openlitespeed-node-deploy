// Collapse request headers that a proxy chain delivered more than once.
//
// Behind Cloudflare + OpenLiteSpeed some headers (notably `Origin`) arrive
// twice. Node joins duplicates of unknown/multi-value headers with ", ", so
// the app sees "https://example.com, https://example.com". Next.js passes
// `Origin` to `new URL()` in its Server Actions CSRF check, which throws
// "TypeError: Invalid URL" and every server action returns HTTP 500.
//
// Call dedupeHeaders(req) first thing in your request handler.

const DEFAULT_HEADERS = ['origin', 'host', 'x-forwarded-host', 'x-forwarded-proto']

function dedupeHeaders(req, names = DEFAULT_HEADERS) {
  for (const name of names) {
    const value = req.headers[name]
    if (Array.isArray(value)) {
      req.headers[name] = value[0]
    } else if (typeof value === 'string' && value.includes(',')) {
      req.headers[name] = value.split(',')[0].trim()
    }
  }
  return req
}

module.exports = { dedupeHeaders, DEFAULT_HEADERS }
