#!/usr/bin/env bash
set -euo pipefail

REPO_ARCHIVE_URL="${RAIN_INSTALL_URL:-https://codeload.github.com/ratacat/raindrop-cli/tar.gz/refs/heads/main}"
INSTALL_ROOT="${RAIN_INSTALL_ROOT:-$HOME/.local/share/raindrop-cli}"
BIN_DIR="${RAIN_BIN_DIR:-$HOME/.local/bin}"
WRAPPER_PATH="$BIN_DIR/rain"
TMP_DIR=""

cleanup() {
  if [[ -n "${TMP_DIR:-}" && -d "${TMP_DIR:-}" ]]; then
    rm -rf "$TMP_DIR"
  fi
}

trap cleanup EXIT

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: required command not found: $1" >&2
    exit 1
  fi
}

install_bun_if_missing() {
  if command -v bun >/dev/null 2>&1; then
    return
  fi

  need_cmd curl
  echo "Bun not found. Installing Bun..."
  curl -fsSL https://bun.sh/install | bash

  export PATH="$HOME/.bun/bin:$PATH"
  if ! command -v bun >/dev/null 2>&1; then
    echo "Error: Bun install completed but bun is not on PATH." >&2
    echo "Try: export PATH=\"\$HOME/.bun/bin:\$PATH\"" >&2
    exit 1
  fi
}

main() {
  need_cmd curl
  need_cmd tar
  need_cmd mktemp
  need_cmd find
  install_bun_if_missing

  TMP_DIR="$(mktemp -d)"

  echo "Downloading raindrop-cli..."
  curl -fsSL "$REPO_ARCHIVE_URL" -o "$TMP_DIR/raindrop-cli.tgz"
  tar -xzf "$TMP_DIR/raindrop-cli.tgz" -C "$TMP_DIR"

  local extracted_dir
  extracted_dir="$(find "$TMP_DIR" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  if [[ -z "$extracted_dir" || ! -d "$extracted_dir" ]]; then
    echo "Error: could not locate extracted project directory." >&2
    exit 1
  fi

  mkdir -p "$(dirname "$INSTALL_ROOT")"
  rm -rf "$INSTALL_ROOT"
  mv "$extracted_dir" "$INSTALL_ROOT"

  echo "Installing dependencies with Bun..."
  (
    cd "$INSTALL_ROOT"
    bun install --frozen-lockfile
  )

  mkdir -p "$BIN_DIR"
  cat >"$WRAPPER_PATH" <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec bun "$INSTALL_ROOT/src/cli.ts" "\$@"
EOF
  chmod +x "$WRAPPER_PATH"

  echo ""
  echo "Installed rain to: $WRAPPER_PATH"
  if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    echo "Note: $BIN_DIR is not in your PATH."
    echo "Add this to your shell profile:"
    echo "  export PATH=\"$BIN_DIR:\$PATH\""
  fi
  echo "Run: rain --version"
}

main "$@"
