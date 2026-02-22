# Test Strategy

This directory defines the full test plan for `rain` before feature implementation.

## Goals

- Lock down CLI contract early (args, output envelopes, exit codes).
- Catch regressions in machine-readable behavior first.
- Keep fast local feedback with Bun-only tooling.

## Test Layers

1. Smoke (`tests/smoke`)
- Validates bootstrap behavior and CLI process wiring.
- Must always pass on every commit.

2. Contract (`tests/contracts`)
- Defines full command behavior from the design doc.
- Implemented as executable contract tests with concrete assertions.
- These represent the target behavior and will initially fail until corresponding commands are implemented.

3. Helpers (`tests/helpers`)
- Shared subprocess harness for invoking `rain` with args/env.

## Coverage Expectations By Command

- `search`: query semantics, default sort, pagination, empty-result behavior.
- `get`: lookup success + `NOT_FOUND` path.
- `add`: single URL, stdin modes, chunking, `--from-suggest`.
- `update`: scalar updates, tag algebra, batch update mode.
- `rm`: trash vs permanent delete flow.
- `ls`: filters, `--all`, `--ids-only`, broken-link filtering.
- `collections` + `collection *`: tree/flat/list + CRUD behavior.
- `tags`: count/name sorting and collection scope.
- `status`: counters, health fields, last-changed timestamp.
- `robot-docs`: schema completeness and compactness.
- `exists`: exit semantics + URL normalization.
- `suggest`: suggestion payload and validation.
- `highlights`: query/scope/filter/limit behavior.
- `export`: JSON and CSV export modes.
- `watch`: since-boundary semantics and race-safe pagination.

## Operational Contracts To Preserve

- Envelope shape:
  - Success: `{ "ok": true, "data": ..., "meta": ...? }`
  - Error: `{ "ok": false, "error": { "code": "...", "message": "...", "suggest": [] } }`
- Exit codes:
  - `0` success
  - `1` not found (resource lookup semantics)
  - `2` invalid args
  - `3` auth errors
  - `4` rate-limited
  - `5` api/network failures

## Running Tests

```bash
bun run test
bun run test:all
bun run test:contracts
```
