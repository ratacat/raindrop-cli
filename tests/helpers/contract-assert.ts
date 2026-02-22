import { expect } from "bun:test";
import type { RunRainResult } from "./run-rain";

type SuccessEnvelope = {
  ok: true;
  data: unknown;
  meta?: Record<string, unknown>;
};

type ErrorEnvelope = {
  ok: false;
  error: {
    code: string;
    message: string;
    suggest?: string[];
  };
};

export function parseJson(result: RunRainResult): unknown {
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`Expected JSON output but got:\n${result.stdout}\nStderr:\n${result.stderr}`);
  }
}

export function expectSuccess(result: RunRainResult, expectedExitCode = 0): SuccessEnvelope {
  expect(result.exitCode).toBe(expectedExitCode);
  expect(result.stderr).toBe("");
  const json = parseJson(result) as SuccessEnvelope;
  expect(json.ok).toBe(true);
  expect(json).toHaveProperty("data");
  return json;
}

export function expectError(result: RunRainResult, code: string, expectedExitCode: number): ErrorEnvelope {
  expect(result.exitCode).toBe(expectedExitCode);
  expect(result.stderr).toBe("");
  const json = parseJson(result) as ErrorEnvelope;
  expect(json.ok).toBe(false);
  expect(json.error.code).toBe(code);
  expect(typeof json.error.message).toBe("string");
  expect(json.error.message.length).toBeGreaterThan(0);
  return json;
}

export function authEnv(baseUrl: string, token = "test-token"): Record<string, string> {
  return {
    RAINDROP_TOKEN: token,
    RAINDROP_API_BASE: baseUrl
  };
}
