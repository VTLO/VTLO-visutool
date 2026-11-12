#!/usr/bin/env sh
# VTLO-visutool — one-shot installer for Antigravity CLI (agy).
# Usage:  sh install-agy.sh [--scope user|project]
#   or:   git clone https://github.com/VTLO/VTLO-visutool && sh VTLO-visutool/install-agy.sh
# Installs the engine into ~/.flow and the /flow skill + workflow for agy. Termux / Linux / macOS.
set -eu
REPO="${VISUTOOL_REPO:-https://github.com/VTLO/VTLO-visutool}"
say()  { printf '\033[36m▸\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

TERMUX=0
if [ -n "${TERMUX_VERSION:-}" ] || [ -d /data/data/com.termux ]; then TERMUX=1; fi

# 1. Node >= 18
if ! have node; then
  if [ "$TERMUX" = 1 ]; then say "installing nodejs (Termux)"; pkg install -y nodejs
  else die "Node.js >= 18 is required (https://nodejs.org)"; fi
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 18 ] || die "Node $NODE_MAJOR found, need >= 18"

# 2. pty helper: agy -p can hang without a TTY, visutool wraps it with `script`
if ! have script; then
  if [ "$TERMUX" = 1 ]; then say "installing util-linux (provides script)"; pkg install -y util-linux || warn "could not install util-linux"
  else warn "'script' not found: agy runs may hang in headless mode (install util-linux / bsdutils)"; fi
fi

# 3. agy present?
if have agy; then say "agy: $(agy --version 2>/dev/null | head -1 || echo found)"
else warn "agy not on PATH — install it first: curl -fsSL https://antigravity.google/cli/install.sh | bash (continuing anyway)"; fi

# 4. locate sources (local checkout, else clone)
HERE=$(cd "$(dirname "$0")" 2>/dev/null && pwd || echo .)
if [ -f "$HERE/flow.mjs" ] && [ -f "$HERE/ui.html" ]; then SRC="$HERE"
else
  have git || die "git is required to fetch $REPO"
  TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
  say "cloning $REPO"
  git clone --depth 1 "$REPO" "$TMP/src" >/dev/null 2>&1 || die "clone failed (private repo? clone it manually, then run its install-agy.sh)"
  SRC="$TMP/src"
fi

# 5. install for agy and verify
node "$SRC/flow.mjs" install --host agy "$@"
echo
node "${HOME}/.flow/flow.mjs" doctor 2>/dev/null || true
say "done — restart agy and type /flow"
