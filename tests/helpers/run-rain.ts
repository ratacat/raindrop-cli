import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

type RunRainOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdin?: string;
};

export type RunRainResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

function mergedEnv(overrides?: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }

  if (!overrides) return env;

  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value === "string") {
      env[key] = value;
    } else {
      delete env[key];
    }
  }

  return env;
}

export function runRain(args: string[], options: RunRainOptions = {}): RunRainResult {
  const cliEntry = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));

  if (typeof options.stdin === "string") {
    return runRainWithStdin(cliEntry, args, options);
  }

  const proc = Bun.spawnSync({
    cmd: ["bun", cliEntry, ...args],
    cwd: options.cwd ?? process.cwd(),
    env: mergedEnv(options.env),
    stdout: "pipe",
    stderr: "pipe"
  });

  return {
    stdout: new TextDecoder().decode(proc.stdout),
    stderr: new TextDecoder().decode(proc.stderr),
    exitCode: proc.exitCode
  };
}

export function runRainJson<T>(args: string[], options: RunRainOptions = {}): RunRainResult & { json: T } {
  const result = runRain(args, options);
  return {
    ...result,
    json: JSON.parse(result.stdout) as T
  };
}

function runRainWithStdin(cliEntry: string, args: string[], options: RunRainOptions): RunRainResult {
  const tempDir = mkdtempSync(join(tmpdir(), "rain-test-"));
  const stdinPath = join(tempDir, "stdin.txt");
  writeFileSync(stdinPath, options.stdin ?? "", "utf8");

  const command = [
    "cat",
    shellQuote(stdinPath),
    "|",
    "bun",
    shellQuote(cliEntry),
    ...args.map(shellQuote)
  ].join(" ");

  try {
    const proc = Bun.spawnSync({
      cmd: ["zsh", "-lc", command],
      cwd: options.cwd ?? process.cwd(),
      env: mergedEnv(options.env),
      stdout: "pipe",
      stderr: "pipe"
    });

    return {
      stdout: new TextDecoder().decode(proc.stdout),
      stderr: new TextDecoder().decode(proc.stderr),
      exitCode: proc.exitCode
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}
