# raindrop-cli

`rain` is a Bun-first CLI for managing Raindrop.io bookmarks with a machine-friendly interface.

## Prerequisites

- Bun `>=1.3.0`

## Quick Start

```bash
bun install
bun run start -- help
```

## CLI Executable

The package exposes a `rain` executable via the `bin` field in `package.json`.

Use it directly from this repo:

```bash
bun run start -- version
```

Link it globally for shell usage:

```bash
bun link
rain help
```

## Scripts

```bash
bun run start -- <args>   # run CLI entrypoint
bun run dev -- <args>     # watch mode
bun run typecheck         # TypeScript checks
bun run test              # smoke suite (green baseline)
bun run test:all          # smoke + contract tests
bun run test:smoke        # bootstrap/smoke suite
bun run test:contracts    # full contract behavior suite (red until implementation)
bun run build             # bundle to dist/cli.js
bun run build:compile     # native executable at dist/rain
```

## Testing

This repo uses Bun's built-in test runner.

```bash
bun test
```

Current tests cover:

- default help output
- version output

Full planned coverage matrix lives in `tests/README.md`.
