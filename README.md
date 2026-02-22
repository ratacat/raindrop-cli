# raindrop-cli

Robot-centric CLI for Raindrop.io bookmarks.

## Setup

```bash
bun install
```

## Run locally

```bash
bun run start -- help
bun run start -- version
```

## Use `rain` as a shell command

Link the package once:

```bash
bun link
```

Then run:

```bash
rain help
```

## Build

```bash
bun run build
bun run build:compile
```

- `build` writes bundled output to `dist/`
- `build:compile` writes a native executable to `dist/rain`
