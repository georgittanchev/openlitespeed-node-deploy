#!/usr/bin/env bash
# Print an OpenLiteSpeed accessControl `allow` line that admits only Cloudflare's
# edge network, plus any extra addresses you pass (your own IP, 127.0.0.1...).
#
#   scripts/cloudflare-allowlist.sh 127.0.0.1 ::1 203.0.113.7
#
# Cloudflare publishes its ranges at https://www.cloudflare.com/ips/ and changes
# them rarely, but it does change them: re-run this every few months.
set -euo pipefail

v4=$(curl -fsS --max-time 15 https://www.cloudflare.com/ips-v4)
v6=$(curl -fsS --max-time 15 https://www.cloudflare.com/ips-v6)
ranges=$( { printf '%s\n' "$@"; printf '%s\n' "$v4"; printf '%s\n' "$v6"; } | sed '/^\s*$/d' | paste -sd, - | sed 's/,/, /g')
echo "  accessControl  {"
echo "    allow                 $ranges"
echo "    deny                  *"
echo "  }"
