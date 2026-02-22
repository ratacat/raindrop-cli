import { describe, expect, test } from "bun:test";

function runRain(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const proc = Bun.spawnSync({
    cmd: ["bun", "src/cli.ts", ...args],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe"
  });

  return {
    stdout: new TextDecoder().decode(proc.stdout),
    stderr: new TextDecoder().decode(proc.stderr),
    exitCode: proc.exitCode
  };
}

describe("rain cli", () => {
  test("shows help by default", () => {
    const result = runRain([]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("rain <command> [options]");
  });

  test("prints version", () => {
    const result = runRain(["version"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("0.1.0");
  });

  test("returns INVALID-style exit on unknown command", () => {
    const result = runRain(["unknown-cmd"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("");

    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      error?: { code?: string; message?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("NOT_IMPLEMENTED");
  });
});
