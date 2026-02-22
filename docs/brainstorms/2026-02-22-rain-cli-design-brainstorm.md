---
date: 2026-02-22
topic: rain-cli-design
---

# rain — Robot-Centric Raindrop CLI

## What We're Building

A CLI tool called `rain` for managing Raindrop.io bookmarks, optimized for use by AI coding agents. Built with TypeScript + Bun. Designed for dense, machine-readable output with zero friction auth and composable commands.

An AI agent running locally (Claude Code, Codex, etc.) calls `rain` via Bash to search, save, organize, and extract knowledge from a user's bookmark collection.

## Why This Approach

**CLI over MCP server** — Simpler to build, test, and debug. Any agent that can run Bash can use it. No protocol overhead. The Unix philosophy (small tools, composable via pipes) maps perfectly to how agents chain operations.

**Bun + TypeScript** — Fast cold starts (critical for CLI), native TypeScript, built-in test runner. No compile step for development.

**Robot-first, human-usable** — TTY detection auto-switches between JSON (piped) and human-readable (interactive). The JSON contract is the primary interface; human output is sugar.

## Key Decisions

- **Binary name: `rain`** — 4 chars, evocative, unlikely to conflict with common system tools
- **Auth: env var or file** — `RAINDROP_TOKEN` env var or `~/.config/rain/token` file. No interactive setup
- **Static token only** — No OAuth flow. Personal use with a copied API token (for example, Raindrop "Test token")
- **JSON envelope** — JSON output is wrapped in `{ok, data, meta}` or `{ok, error}` for predictable parsing
- **Exit codes** — 0=success, 1=not found (single-resource lookups), 2=bad args, 3=auth, 4=rate limit, 5=API/network error
- **TTY detection** — `process.stdout.isTTY` switches output mode automatically

---

## Full Command Surface

### Core Commands (Base)

```
rain search <query>              Search bookmarks (full-text + operators)
rain get <id>                    Get single bookmark by ID
rain add <url>                   Save a new bookmark
rain update <id>                 Update bookmark fields
rain rm <id>                     Trash a bookmark (or permanently delete with `--permanent`)
rain ls [collection]             List bookmarks with filters (first 25; --all for everything)
rain collections                 List collections (flat or tree)
rain collection create <title>   Create a new collection
rain collection update <id>      Update collection fields
rain collection rm <id>          Delete a collection tree (moves bookmarks to Trash)
rain tags [collection]           List tags with counts
rain status                      Account stats, counts, broken/dupes
```

### Power Commands (Upgrades)

```
rain robot-docs               Full CLI schema in one JSON blob (~1-2k tokens)
rain exists <url>             Check if URL already bookmarked (single URL: exit 0=yes, 1=no)
rain suggest <url>            Get suggested collection + tags for a URL
rain highlights [collection]  List/search highlights (annotations)
rain export [collection]      Bulk export (json/csv)
rain watch --since <ts>       Bookmarks added/modified since timestamp
```

---

## Command Details

### rain search <query>

Search bookmarks using Raindrop's search operators. Defaults to relevance sorting (`score`) when a text query is present; falls back to `-created` for operator-only queries.

```bash
rain search "typescript testing"                        # relevance-sorted by default
rain search "#api" --collection 12345                   # by tag (no text query → sorted by -created)
rain search "type:article typescript" --sort -created   # override: chronological instead of relevance
rain search "created:>2024-01-01"                       # date filter
```

**Output (JSON):**
```json
{
  "ok": true,
  "data": [
    {
      "id": 483920,
      "title": "Testing TypeScript APIs",
      "link": "https://example.com/article",
      "tags": ["api", "testing"],
      "collection": {"id": 123, "title": "Dev"},
      "excerpt": "A guide to...",
      "type": "article",
      "created": "2024-06-15T10:30:00Z",
      "important": false
    }
  ],
  "meta": {"count": 1, "page": 0, "total": 1}
}
```

**Output (TTY):**
```
483920  Testing TypeScript APIs                    [api, testing]  Dev
        https://example.com/article                article         2024-06-15
```

### rain get <id>

Full bookmark details including highlights, notes, cache status.

```bash
rain get 483920
rain get 483920 --fields title,link,tags    # select fields
```

### rain add <url>

Save a new bookmark.

```bash
rain add https://example.com
rain add https://example.com --title "My Title" --tags api,go --collection 123
rain add https://example.com --parse              # request async metadata parsing (title/excerpt fill in background)
rain add https://example.com --from-suggest        # use first suggested collection + all suggested tags
```

`--from-suggest` should be best-effort: if suggestions are empty or unavailable, still save the bookmark with any explicit flags the user passed.

Stdin batch mode (auto-detects format — plain URLs or JSONL). The multi-create endpoint accepts up to 100 items per request; CLI auto-chunks larger batches.
```bash
# Plain URLs (one per line, flags apply to all)
printf '%s\n' "https://a.com" "https://b.com" | rain add --tags research

# JSONL (per-item metadata)
printf '%s\n' \
  '{"link":"https://a.com","tags":["api"]}' \
  '{"link":"https://b.com","tags":["docs"],"collection":123}' | rain add
```

**Output (single):**
```json
{
  "ok": true,
  "data": {"id": 483921, "title": "...", "link": "https://example.com"}
}
```

**Output (batch):**
```json
{
  "ok": true,
  "data": [{"id": 483921, "link": "https://a.com"}, {"id": 483922, "link": "https://b.com"}],
  "meta": {"count": 2}
}
```

### rain update <id>

Update bookmark fields. Supports client-side tag algebra (`+` add, `-` remove, `=` replace).

Tag algebra (`+add`, `-remove`) requires a read-modify-write cycle internally (the single-raindrop API replaces the full tags array). The `=replace` prefix sets tags directly in one call.

```bash
rain update 483920 --title "New Title"
rain update 483920 --tags +new,-old              # add "new", remove "old" (2 API calls)
rain update 483920 --tags =only,these            # replace all tags (1 API call)
rain update 483920 --collection 456              # move to collection
rain update 483920 --important true              # mark as favorite
rain update 483920 --note "Agent reviewed 2024-06-15"
```

Batch update via stdin (IDs from stdin replace positional `<id>`). The bulk update endpoint natively appends tags, so `+` prefix is unnecessary but kept for consistency. Note: batch mode only supports tag addition (`+`); tag removal (`-`) and replacement (`=`) require per-item API calls, so they are not supported in batch mode. Include `--all` when you truly mean the whole collection:
```bash
rain ls --all --ids-only --notag --json | jq -r '.data[]' | rain update --tags +needs-review
```

### rain rm <id>

Move to Trash. `--permanent` moves to Trash first if needed, then permanently deletes (Raindrop only allows permanent deletion from Trash).

```bash
rain rm 483920                 # move to Trash
rain rm 483920 --permanent     # ensure Trash, then permanently delete (1-2 API calls)
```

### rain ls [collection]

List bookmarks with filters. Returns first 25 by default; pass `--all` to paginate through everything. Filter flags (`--tag`, `--type`, `--important`, `--notag`) map to Raindrop search operators internally; `--broken` is client-side filtered.

```bash
rain ls                                  # first 25 bookmarks
rain ls --all                            # all bookmarks (auto-paginates)
rain ls 123                              # collection by ID
rain ls --tag api                        # filter by tag (maps to #api search operator)
rain ls --type article                   # filter by type (maps to type:article)
rain ls --important                      # favorites only (maps to important:true search param)
rain ls --sort -created --limit 10       # newest 10
rain ls --ids-only                       # just IDs (for piping)
rain ls --notag                          # untagged bookmarks (maps to notag:true)
rain ls --all --broken                   # broken links (client-side filter; use --all for complete results)
```

### rain collections

List all collections as a flat list or tree.

```bash
rain collections                  # flat list with counts
rain collections --tree           # nested tree structure
rain collections --ids-only       # just IDs
```

**Output (JSON):**
```json
{
  "ok": true,
  "data": [
    {"id": 123, "title": "Dev", "count": 42, "parent": null},
    {"id": 456, "title": "APIs", "count": 15, "parent": 123}
  ]
}
```

### rain tags [collection]

```bash
rain tags                   # all tags with counts
rain tags 123               # tags in collection 123
rain tags --sort count      # by count (default)
rain tags --sort name       # alphabetical
```

Sorting is client-side (`count` or `name`) after fetching tags.

**Output (JSON):**
```json
{
  "ok": true,
  "data": [
    {"tag": "api", "count": 100},
    {"tag": "testing", "count": 42}
  ]
}
```

### rain status

Account overview — total counts, broken links, duplicates, and last-change timestamp.

```bash
rain status
```

**Output (JSON):**
```json
{
  "ok": true,
  "data": {
    "total": 1570,
    "unsorted": 34,
    "trash": 543,
    "pro": true,
    "broken": 31,
    "duplicates": 3,
    "lastChanged": "2024-06-15T10:30:00Z"
  }
}
```

### rain collection create <title>

Create a new collection.

```bash
rain collection create "Research"
rain collection create "APIs" --parent 123        # nested under collection 123
rain collection create "Public Reads" --public
```

### rain collection update <id>

Update collection properties.

```bash
rain collection update 123 --title "New Name"
rain collection update 123 --parent 456           # move under another collection
rain collection update 123 --view grid
```

### rain collection rm <id>

Delete a collection and all nested sub-collections. Bookmarks inside move to Trash.

```bash
rain collection rm 123
```

### rain robot-docs

Self-describing schema. Agent calls this once to learn the full CLI.

```bash
rain robot-docs
```

**Output:** A single JSON blob describing every command, its args, flags, output shape, and exit codes. Target ~1-2k tokens — compact enough to load into agent context in one call.

```json
{
  "ok": true,
  "data": {
    "commands": {
      "search": {
        "args": ["query:string"],
        "flags": {"--collection": "int", "--sort": "string", "--limit": "int", "--page": "int"},
        "output": "Raindrop[]",
        "exits": {"0": "success (even if no results)"}
      },
      ...
    },
    "types": {
      "Raindrop": {"id": "int", "title": "string", "link": "string", "tags": "string[]", ...}
    },
    "common_flags": ["--json", "--limit", "--fields", "--collection", "--sort", "--page", "--all", "--ids-only"],
    "exit_codes": {"0": "success", "1": "not found", "2": "bad args", "3": "auth", "4": "rate limit", "5": "api/network error"},
    "auth": "RAINDROP_TOKEN env var or ~/.config/rain/token"
  }
}
```

### rain exists <url>

Dedup check. For a single URL, exit code is the answer (0=exists, 1=not found). The lookup should normalize obvious URL variants (scheme, trailing slash, tracking params) before declaring "not found."

```bash
rain exists https://example.com
# exit 0 → already saved, data contains the existing bookmark ID
# exit 1 → not saved
```

**Output (single URL, when exists):**
```json
{"ok": true, "data": {"id": 483920}}
```

**Output (single URL, when not found — exit 1):**
```json
{"ok": true, "data": null}
```

Note: exit 1 signals "not bookmarked" (like `grep` returning 1 for no matches). This is a valid answer, not an error — so the envelope uses `ok: true` with `data: null`. Actual errors (auth, network) use `ok: false` with the error envelope and exit codes 2-5.

Batch mode (always exits 0; use data to check per-URL results):
```bash
printf '%s\n' "https://a.com" "https://b.com" | rain exists
```

**Output (batch):**
```json
{
  "ok": true,
  "data": [
    {"link": "https://a.com", "id": 483920},
    {"link": "https://b.com", "id": null}
  ]
}
```

### rain suggest <url>

Get Raindrop's suggested collection and tags for a URL.

```bash
rain suggest https://example.com/article
```

**Output:**
```json
{
  "ok": true,
  "data": {
    "collections": [{"id": 123}],
    "tags": ["typescript", "testing"]
  }
}
```

Useful for inspection before saving. To act on suggestions directly, use `rain add <url> --from-suggest` instead.

### rain highlights [collection]

List highlights (annotations) across bookmarks. Color filtering is applied client-side.

```bash
rain highlights                       # all highlights
rain highlights 123                   # from collection
rain highlights --color yellow        # client-side filter by color
rain highlights --limit 50
```

**Output:**
```json
{
  "ok": true,
  "data": [
    {
      "id": "abc123",
      "text": "The key insight is...",
      "note": "Important for our architecture",
      "color": "yellow",
      "raindrop": {"id": 483920, "title": "Article Title"},
      "link": "https://example.com/article",
      "created": "2024-06-15T10:30:00Z"
    }
  ]
}
```

### rain export [collection]

Bulk export for offline analysis. Uses the list endpoint with auto-pagination. Supports `--fields` for column selection and `--format csv` for CSV output (generated client-side from the JSON data).

```bash
rain export                              # all bookmarks as JSON (auto-paginates list endpoint)
rain export 123                          # single collection
rain export --format csv                 # CSV output (client-side conversion from API JSON)
rain export --fields id,title,link,tags  # select fields
```

### rain watch --since <timestamp>

Poll for changes since a timestamp (ISO 8601 UTC, e.g. `2024-06-15T00:00:00Z`). Implemented client-side: sort by `-lastUpdate` and paginate until all bookmarks older than the cutoff are reached. Since concurrent updates can shift items between pages during pagination, subtract a small safety margin (e.g. 60s) from the cutoff and de-dup results by bookmark ID. `rain status` can be used as a cheap pre-check (`lastChanged`) before a full scan.

```bash
rain watch --since 2024-06-15T00:00:00Z
rain watch --since 2024-06-15T00:00:00Z --collection 123
```

**Output:** Same format as `rain ls`, containing only bookmarks modified after the timestamp.

---

## Common Flags Reference

Not every command accepts every flag below; unsupported combinations should return `INVALID_ARGS`.

| Flag | Short | Type | Default | Description |
|------|-------|------|---------|-------------|
| --json | -j | bool | auto | Force JSON output |
| --limit | -l | int | command-specific | Max results per page where supported (API max: 50 on list/search-like endpoints) |
| --fields | -f | string | command-specific | Comma-separated field names (supported in JSON-producing commands only) |
| --collection | -c | int | all collections | Scope to collection ID on commands that support collection filters |
| --sort | -s | string | command-specific | Sort order; defaults differ by command (`-created` for ls, `score` for search with text query, `-created` for search without text query, `count` for tags) |
| --page | -p | int | 0 | Page number where manual pagination is exposed |
| --all | | bool | false | Auto-paginate through all results (supported on list/export-like commands) |
| --ids-only | | bool | false | Output only IDs (`data: number[]` in JSON, one-per-line in TTY) where supported |

---

## Error Contract

Every error includes a code, message, and actionable suggestions:

```json
{
  "ok": false,
  "error": {
    "code": "AUTH_MISSING",
    "message": "No API token found",
    "suggest": [
      "Set RAINDROP_TOKEN env var",
      "Or create ~/.config/rain/token",
      "Get token: https://app.raindrop.io/settings/integrations"
    ]
  }
}
```

Error codes (exit code in parens):
- `AUTH_MISSING` (3) — no token configured
- `AUTH_INVALID` (3) — token rejected by API
- `NOT_FOUND` (1) — resource doesn't exist
- `INVALID_ARGS` (2) — bad arguments or flags
- `RATE_LIMITED` (4) — too many requests
- `API_ERROR` (5) — upstream API failure
- `NETWORK_ERROR` (5) — can't reach API

---

## Agent Workflow Examples

**Research workflow:**
```bash
# 1. Check what's already saved
rain search "typescript testing" --limit 5

# 2. Check if a new URL is already bookmarked
rain exists https://new-article.com

# 3. Get suggestions for categorization
rain suggest https://new-article.com

# 4. Save with auto-categorization
rain add https://new-article.com --from-suggest --tags research

# 5. Mark as reviewed
rain update 483921 --tags +reviewed --note "Covers unit + integration testing"
```

**Knowledge extraction:**
```bash
# 1. Learn the CLI
schema=$(rain robot-docs)

# 2. See what's available
rain status
rain collections
rain tags --sort count

# 3. Extract highlights from a topic
rain highlights --limit 50 | jq '.data[].text'

# 4. Bulk export for analysis
rain export 123 > collection.json
```

**Maintenance workflow:**
```bash
# Find broken links
rain ls --all --broken --ids-only --json | jq '.data | length'

# Batch-tag untagged items
rain ls --all --ids-only --notag --json | jq -r '.data[]' | rain update --tags +needs-review

# Check for recent additions
rain watch --since 2024-06-14T00:00:00Z
```

---

## Tech Stack

- **Runtime:** Bun
- **Language:** TypeScript
- **CLI framework:** Minimal — `process.argv` parsing or lightweight lib (citty, clipanion)
- **HTTP:** Bun native fetch
- **Config:** env var + file (~/.config/rain/token)
- **Testing:** Bun test runner
- **Build:** `bun build` to single executable

## Resolved Decisions

- **`rain ls` safety**: Requires `--all` to dump everything. Default returns first 25 only.
- **Stdin format**: Auto-detects per line after trimming. First non-whitespace char `{` => JSONL object; otherwise parse as plain URL.
- **Collection CRUD**: Yes, included in base command set (`rain collection create/update/rm`).

## Next Steps

-> Plan implementation phases and start building
