# openlitespeed-node-deploy

Running Node apps and static builds behind **OpenLiteSpeed** (and CyberPanel) and **Cloudflare**, without the problems I had to debug the hard way.

I run a production server where one OpenLiteSpeed vhost serves a static Astro site plus half a dozen Node apps on sub-paths (Next.js, Express, MCP servers), all behind Cloudflare. Every item below broke something in production at least once. The documentation for these setups is thin, so this repo collects the configs, scripts and explanations in one place.

| Problem | Symptom | Fix in this repo |
|---|---|---|
| [Deploys cause downtime](#1-zero-downtime-static-deploys) | Every URL 404s while the site builds | `scripts/atomic-swap`, `scripts/deploy-static.sh` |
| [Duplicated `Origin` header](#2-nextjs-server-actions-fail-with-http-500) | Next.js Server Actions return 500, `TypeError: Invalid URL` | `node/dedupe-headers.cjs`, `node/next-server.cjs` |
| [Node app on a sub-path](#3-a-node-app-under-a-path-of-an-existing-site) | Charset on images, buffered streams, timeouts | `examples/node-app-on-a-path.conf` |
| [IP-restricting a path behind Cloudflare](#4-restrict-a-path-to-your-own-ip-behind-cloudflare) | Allowlist sees only Cloudflare IPs, or the header can be forged | `examples/cloudflare-ip-gate.conf`, `scripts/cloudflare-allowlist.sh` |
| [Environment variables you didn't set](#5-environment-traps) | 401 from an API with a correct `.env`, app bound to the wrong host | Notes + `node/next-server.cjs` |
| [ModSecurity and JSON APIs](#6-other-openlitespeed-gotchas) | Webhooks / JSON-RPC blocked with 403 | `examples/json-api-without-modsecurity.conf` |

## 1. Zero-downtime static deploys

Most static site generators (Astro, Vite, Next export) **delete their output directory before building**. If your web server serves that directory, every page returns 404 for as long as the build runs. For me that was 30–60 seconds per deploy, and a visitor hit it.

Building into a second directory and swapping with two `mv` calls is better but still not atomic. Between the two renames the live path doesn't exist. Under load I measured **one 404 in 117 requests** during the swap.

Linux can exchange two paths in a single syscall: `renameat2(..., RENAME_EXCHANGE)`. There is no instant where the live directory is missing.

```bash
# swap two directories atomically (NEW becomes live, LIVE ends up in NEW)
scripts/atomic-swap /var/www/site/dist.next /var/www/site/dist

# or the full flow: build into dist.next, check it, swap, clean up
scripts/deploy-static.sh /var/www/site/dist npx astro build --outDir /var/www/site/dist.next
MIN_FILES=200 scripts/deploy-static.sh /var/www/site/dist npm run build -- --outDir /var/www/site/dist.next
```

`deploy-static.sh` refuses to swap if the build has no `index.html` or produced fewer than `MIN_FILES` files, so a half-failed build never goes live. Check the result on disk. A build tool can exit 0 after silently dropping files.

Requirements: Linux ≥ 3.15, glibc ≥ 2.28, Python 3, both directories on the same filesystem. Servers that resolve the path on every request (OpenLiteSpeed static contexts, `serve`, nginx) pick up the new release immediately. A process that has `chdir`ed into the old directory keeps the old one until it restarts.

Rollback is the same command again before you delete the old release.

## 2. Next.js Server Actions fail with HTTP 500

Behind **Cloudflare + OpenLiteSpeed**, some request headers reach the app twice, notably `Origin`. Node joins duplicate headers with `", "`, so the app sees:

```
origin: https://example.com, https://example.com
```

Next.js passes `Origin` to `new URL()` in its Server Actions CSRF check. That throws `TypeError: Invalid URL`, and every server action (login forms, mutations) fails with HTTP 500 and "This page couldn't load". Pages render fine, which makes it confusing.

The fix is a small custom server that collapses those headers before Next sees them:

```bash
cp node/dedupe-headers.cjs node/next-server.cjs /path/to/your-next-app/
cd /path/to/your-next-app && npm run build
PORT=6010 BIND_HOST=127.0.0.1 node next-server.cjs   # instead of `next start`
```

`node node/test-dedupe.cjs` sends a real duplicated header through a socket and shows the before/after. `dedupeHeaders(req)` works in any Node HTTP handler (Express, Fastify's raw request, plain `http`).

## 3. A Node app under a path of an existing site

`examples/node-app-on-a-path.conf` has an `extprocessor` (the upstream) and a `context` (the path). Settings worth knowing:

- **`addDefaultCharset off`** — otherwise OpenLiteSpeed appends a charset to every `Content-Type` it proxies.
- **`respBuffer 0`** — don't buffer responses, so streamed output (SSE, chunked responses) reaches the client as it's produced.
- **`initTimeout`** — how long OpenLiteSpeed waits for the app's first byte. A request that takes longer is cut off by the proxy, not the app. For slow endpoints, set it above your slowest request. Behind Cloudflare, the 100-second edge timeout is the real ceiling.
- **Bind the app to `127.0.0.1`**, never `0.0.0.0`. Only the proxy should reach it.
- **The most specific context wins.** `/app/admin` and `/app` can point to different handlers, and a catch-all `context /` (common when the whole site is a proxied app) doesn't swallow them.
- **Basic-auth realms apply to everything nested under the context.** If `/files` has a password realm, a public endpoint at `/files/hook` inherits it. Put public endpoints outside protected paths.
- WebSockets need the `Upgrade` / `Connection` headers: `examples/websocket.conf`.
- After editing, `/usr/local/lsws/bin/lswsctrl reload`. Keep a copy of `vhost.conf` before every edit.

## 4. Restrict a path to your own IP behind Cloudflare

Behind Cloudflare every request arrives from a Cloudflare IP, so a normal IP allowlist can't see the visitor. The visitor's address is in `CF-Connecting-IP`. But if someone finds your origin IP, they can connect directly and send that header with any value.

`examples/cloudflare-ip-gate.conf` uses two layers:

1. `accessControl` admits only Cloudflare's published ranges (plus loopback), so nobody can reach the path without going through Cloudflare, and Cloudflare sets the header itself.
2. A rewrite rule returns 403 unless `CF-Connecting-IP` is one of yours.

Generate a current allow line, with your own addresses first:

```bash
scripts/cloudflare-allowlist.sh 127.0.0.1 ::1 203.0.113.7 2001:db8:1234:5678::/64
```

Cloudflare's ranges rarely change, but they do. Re-run it every few months, and include the IPv6 ranges too.

## 5. Environment traps

Two things broke apps on my server even though their config files were correct:

- **A variable exported in a shell profile beats `.env`.** dotenv and Next.js both let a real environment variable win over the `.env` file. An old API key exported in `~/.bashrc` made an app run as that user return 401 from the API. Use `dotenv.config({ override: true })` for apps whose `.env` is the source of truth.
- **`HOSTNAME` is usually set to the machine's name.** An app that binds to `process.env.HOSTNAME` will pick it up, and `pm2 restart --update-env` passes it on even when your ecosystem file says otherwise. Use your own variable (`BIND_HOST`) for the bind address, as `node/next-server.cjs` does.

Also: run pm2 as the site's own Linux user rather than root, and `pm2 save` after changing the process list (`examples/ecosystem.config.cjs`). Otherwise a reboot brings back the old list.

## 6. Other OpenLiteSpeed gotchas

- **ModSecurity and JSON APIs.** With a generic ModSecurity rule set enabled (CyberPanel can install the OWASP rules), JSON bodies that contain URLs, HTML or code (webhooks, JSON-RPC, MCP servers) get blocked. Turn it off for that one context (`examples/json-api-without-modsecurity.conf`) and make the endpoint authenticate requests itself.
- **`.htaccess` redirects and a proxied root.** When `context /` proxies to a Node or static server, `.htaccess` files in the document root are never consulted for those URLs. Do redirects in the app or server you proxy to, or at Cloudflare.

## Layout

```
scripts/atomic-swap            renameat2(RENAME_EXCHANGE) directory swap
scripts/deploy-static.sh       build into <dir>.next, verify, swap
scripts/cloudflare-allowlist.sh   accessControl line from Cloudflare's published ranges
node/dedupe-headers.cjs        collapse duplicated proxy headers
node/next-server.cjs           Next.js production server using it
node/test-dedupe.cjs           reproduces the duplicated-Origin bug and the fix
examples/*.conf                OpenLiteSpeed vhost snippets
examples/ecosystem.config.cjs  pm2 config
```

Tested on OpenLiteSpeed 1.9 (CyberPanel), AlmaLinux 9, Node 20/22, behind Cloudflare.

## License

MIT — see [LICENSE](LICENSE).

## Author

Georgi Tanchev — https://tanchev.net
