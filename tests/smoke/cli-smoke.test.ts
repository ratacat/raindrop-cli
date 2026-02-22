import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { runRain } from "../helpers/run-rain";

const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  version: string;
};

describe("rain cli smoke", () => {
  const helpInputs: string[][] = [[], ["help"], ["--help"], ["-h"]];

  for (const args of helpInputs) {
    const label = args.length === 0 ? "<empty>" : args.join(" ");
    test(`shows help for ${label}`, () => {
      const result = runRain(args);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Usage:");
      expect(result.stdout).toContain("rain <command> [options]");
    });
  }

  const versionInputs = [["version"], ["--version"], ["-v"]];

  for (const args of versionInputs) {
    test(`shows package version for ${args[0]}`, () => {
      const result = runRain(args);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout.trim()).toBe(packageJson.version);
    });
  }

});
