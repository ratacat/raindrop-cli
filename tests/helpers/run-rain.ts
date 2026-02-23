import { fileURLToPath } from "node:url";

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

async function collectProcessOutput(proc: Bun.Subprocess): Promise<RunRainResult> {
  if (!(proc.stdout instanceof ReadableStream) || !(proc.stderr instanceof ReadableStream)) {
    throw new Error("runRain requires piped stdout/stderr streams");
  }

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text()
  ]);

  return {
    stdout,
    stderr,
    exitCode: typeof exitCode === "number" ? exitCode : 1
  };
}

export async function runRain(args: string[], options: RunRainOptions = {}): Promise<RunRainResult> {
  const cliEntry = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));

  const proc = Bun.spawn({
    cmd: ["bun", cliEntry, ...args],
    cwd: options.cwd ?? process.cwd(),
    env: mergedEnv(options.env),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe"
  });

  if (typeof options.stdin === "string" && proc.stdin) {
    proc.stdin.write(options.stdin);
  }
  if (proc.stdin) {
    proc.stdin.end();
  }

  return collectProcessOutput(proc);
}

export async function runRainJson<T>(
  args: string[],
  options: RunRainOptions = {}
): Promise<RunRainResult & { json: T }> {
  const result = await runRain(args, options);
  return {
    ...result,
    json: JSON.parse(result.stdout) as T
  };
}
