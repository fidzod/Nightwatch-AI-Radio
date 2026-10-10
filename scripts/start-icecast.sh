#!/usr/bin/env bash
# Generates a local icecast.xml (paths resolved against the current Nix
# store closure, so it isn't committed — store paths shift on every `nix
# flake update`) and launches icecast against it.
#
# Run via: nix develop -c scripts/start-icecast.sh
set -euo pipefail
cd "$(dirname "$0")/.."

command -v icecast >/dev/null || {
  echo "icecast not on PATH — run this inside 'nix develop'." >&2
  exit 1
}

icecast_bin="$(command -v icecast)"
icecast_share="$(dirname "$(dirname "$icecast_bin")")/share/icecast"

mkdir -p data/icecast/logs

password="${ICECAST_SOURCE_PASSWORD:-hackme}"
port="${ICECAST_PORT:-8000}"

cat > data/icecast/icecast.generated.xml <<EOF
<icecast>
    <location>Nightwatch</location>
    <admin>admin@localhost</admin>
    <hostname>localhost</hostname>
    <limits>
        <clients>100</clients>
        <sources>2</sources>
        <queue-size>524288</queue-size>
        <client-timeout>30</client-timeout>
        <header-timeout>15</header-timeout>
        <source-timeout>10</source-timeout>
        <burst-size>65535</burst-size>
    </limits>
    <authentication>
        <source-password>${password}</source-password>
        <relay-password>${password}</relay-password>
        <admin-user>admin</admin-user>
        <admin-password>${password}</admin-password>
    </authentication>
    <listen-socket>
        <port>${port}</port>
    </listen-socket>
    <http-headers>
        <header type="cors" name="Access-Control-Allow-Origin" />
    </http-headers>
    <paths>
        <basedir>${icecast_share}</basedir>
        <logdir>$(pwd)/data/icecast/logs</logdir>
        <webroot>${icecast_share}/web</webroot>
        <adminroot>${icecast_share}/admin</adminroot>
        <alias source="/" destination="/status.xsl"/>
    </paths>
    <logging>
        <accesslog>access.log</accesslog>
        <errorlog>error.log</errorlog>
        <loglevel>information</loglevel>
        <logsize>10000</logsize>
    </logging>
    <security>
        <chroot>false</chroot>
    </security>
</icecast>
EOF

echo "icecast source password: ${password} (override with ICECAST_SOURCE_PASSWORD env var — must match liquidsoap/radio.liq)"
exec icecast -c data/icecast/icecast.generated.xml
