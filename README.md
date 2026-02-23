# raindrop-cli

`rain` is a Bun-first CLI for Raindrop.io that is designed for **AI/agent integration first**, not hand-crafted interactive terminal use.

It provides stable, machine-readable JSON envelopes and predictable exit codes so LLM agents, scripts, and automations can reliably compose bookmark workflows.

## Who It Is For

- AI agents and tool-calling systems
- scripts and automation pipelines
- developers who need deterministic CLI behavior

If you want a human-centric TUI or rich interactive prompts, this project is not optimized for that.

## Core Design

- JSON-first output contracts
- explicit error codes and exit codes
- batch-friendly stdin workflows
- Bun-only runtime and tooling

## Installation

Prerequisite:

- Bun `>=1.3.0`

One-line installer:

```bash
curl -fsSL https://raw.githubusercontent.com/ratacat/raindrop-cli/main/scripts/install.sh | bash
```

This installs project files to `~/.local/share/raindrop-cli` and creates `~/.local/bin/rain`.
Run the same command again to update.

Install dependencies:

```bash
bun install
```

Use directly from repo:

```bash
bun run start -- help
```

Expose `rain` in your shell:

```bash
bun link
rain help
```

## Authentication

`rain` reads auth in this order:

1. `RAINDROP_TOKEN`
2. `~/.config/rain/token`

For personal/private use, generate a **Test Token** in Raindrop:

1. Go to `app.raindrop.io`
2. Open `Settings`
3. Open `Integrations`
4. Create an app
5. Create a **Test Token** under that app

Use that test token as your `RAINDROP_TOKEN`.

`client_id` and `client_secret` are for OAuth apps used by other users. For your own account automation, test token is the simplest path.

Recommended local setup:

```bash
mkdir -p ~/.config/rain
printf '%s\n' '<your-raindrop-token>' > ~/.config/rain/token
chmod 600 ~/.config/rain/token
```

## Quickstart

```bash
# verify CLI wiring
rain --version

# machine-readable schema
rain robot-docs --json

# search bookmarks (JSON envelope output)
rain search "typescript" --json
```

## Command Surface

- `search`
- `get`
- `add`
- `update`
- `rm`
- `ls`
- `collections`
- `collection create|update|rm`
- `tags`
- `status`
- `robot-docs`
- `exists`
- `suggest`
- `highlights`
- `export`
- `watch`

## Output Contract

Success:

```json
{ "ok": true, "data": {}, "meta": {} }
```

Error:

```json
{ "ok": false, "error": { "code": "INVALID_ARGS", "message": "...", "suggest": [] } }
```

Exit codes:

- `0` success
- `1` not found
- `2` invalid args
- `3` auth errors
- `4` rate limited
- `5` API or network failure

## Scripts

```bash
bun run start -- <args>   # run CLI entrypoint
bun run dev -- <args>     # watch mode
bun run typecheck         # TypeScript checks
bun run test              # smoke suite
bun run test:all          # all tests
bun run test:smoke        # smoke tests
bun run test:contracts    # local contract tests
bun run test:live         # opt-in live API tests
bun run build             # bundle to dist/cli.js
bun run build:compile     # native executable at dist/rain
```

## Testing

Run all default tests:

```bash
bun test
```

Live tests are opt-in, read-only, and require env vars:

```bash
export RAIN_LIVE_TESTS=1
export RAINDROP_LIVE_TOKEN="<your-test-token>"
bun run test:live
```

Optional:

- `RAINDROP_API_BASE` for non-default API endpoints
