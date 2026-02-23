# raindrop-cli Agent Notes

## Runtime and Tooling

This repository is Bun-first. Use Bun for everything.

- Use `bun install` for dependencies
- Use `bun run <script>` for scripts
- Use `bun test` for tests
- Use `bun build` for builds
- Use `bunx` for one-off CLIs (for example, `bunx tsc --noEmit`)

Do not introduce npm, pnpm, yarn, or node-only workflow steps unless explicitly requested.

After you commit in this repository, always push immediately.

## CLI Executable

The CLI command is `rain`.

- Source entrypoint: `src/cli.ts`
- Package bin mapping: `package.json` -> `"bin": { "rain": "./src/cli.ts" }`
- For local shell usage from anywhere, run `bun link` in this repo once.
