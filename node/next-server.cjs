// Production server for a Next.js app behind Cloudflare + OpenLiteSpeed.
// Use it instead of `next start`:  node next-server.cjs
//
// It does two things `next start` doesn't:
//   1. de-duplicates proxy headers (see dedupe-headers.cjs), which fixes
//      HTTP 500 on Server Actions;
//   2. binds to BIND_HOST, not HOSTNAME. Many shells export HOSTNAME (the
//      machine name) and `pm2 restart --update-env` passes it on, which can
//      move a loopback-only app onto another interface.
const { createServer } = require('node:http')
const next = require('next')
const { dedupeHeaders } = require('./dedupe-headers.cjs')

const port = Number(process.env.PORT) || 3000
const hostname = process.env.BIND_HOST || '127.0.0.1'

const app = next({ dev: false, hostname, port })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  createServer((req, res) => {
    dedupeHeaders(req)
    handle(req, res)
  }).listen(port, hostname, () => {
    console.log(`> ready on http://${hostname}:${port}`)
  })
})
