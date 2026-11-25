// node node/test-dedupe.cjs — sends a duplicated Origin header through a real socket.
const assert = require('node:assert')
const http = require('node:http')
const net = require('node:net')
const { dedupeHeaders } = require('./dedupe-headers.cjs')

const server = http.createServer((req, res) => {
  const before = req.headers.origin
  dedupeHeaders(req)
  res.end(JSON.stringify({ before, after: req.headers.origin }))
})
server.listen(0, '127.0.0.1', () => {
  const { port } = server.address()
  const sock = net.connect(port, '127.0.0.1', () => {
    sock.write('POST / HTTP/1.1\r\nHost: x\r\nOrigin: https://example.com\r\nOrigin: https://example.com\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
  })
  let data = ''
  sock.on('data', (c) => (data += c))
  sock.on('end', () => {
    const body = JSON.parse(data.slice(data.indexOf('\r\n\r\n') + 4))
    assert.strictEqual(body.before, 'https://example.com, https://example.com')
    assert.strictEqual(body.after, 'https://example.com')
    assert.doesNotThrow(() => new URL(body.after))
    console.log('ok: duplicated Origin collapsed to', body.after)
    server.close()
  })
})
