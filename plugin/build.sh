#!/usr/bin/env bash
# Builds musichub.ndp with the Go toolchain in Docker (no local Go needed).
set -euo pipefail
cd "$(dirname "$0")"
ND_VERSION="${ND_VERSION:-v0.64.2}"

if [ ! -d .pdk/go ]; then
  tmp=$(mktemp -d)
  git clone -q --depth 1 --branch "$ND_VERSION" https://github.com/navidrome/navidrome.git "$tmp"
  mkdir -p .pdk && cp -r "$tmp/plugins/pdk/go" .pdk/go && rm -rf "$tmp"
fi

docker run --rm -v "$PWD":/src -w /src -e GOFLAGS=-mod=mod golang:1.25 bash -c '
  set -e
  cat > go.mod <<EOF
module musichub-plugin

go 1.25

require github.com/navidrome/navidrome/plugins/pdk/go v0.0.0

replace github.com/navidrome/navidrome/plugins/pdk/go => ./.pdk/go
EOF
  go mod tidy >/dev/null
  GOOS=wasip1 GOARCH=wasm go build -buildmode=c-shared -o plugin.wasm .
  chown -R '"$(id -u):$(id -g)"' /src
'
rm -f musichub.ndp
zip -qj musichub.ndp manifest.json plugin.wasm
rm -f plugin.wasm
ls -la musichub.ndp
