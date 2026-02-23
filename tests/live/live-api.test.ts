import { describe, expect, test } from "bun:test";
import { runRain } from "../helpers/run-rain";

const DEFAULT_BASE = "https://api.raindrop.io/rest/v1";
const ENABLED = process.env.RAIN_LIVE_TESTS === "1";
const TOKEN = process.env.RAINDROP_LIVE_TOKEN?.trim();
const BASE_URL = process.env.RAINDROP_API_BASE?.trim() || DEFAULT_BASE;

function buildUrl(pathname: string, query?: Record<string, string>): URL {
  const base = BASE_URL.endsWith("/") ? BASE_URL : `${BASE_URL}/`;
  const relativePath = pathname.replace(/^\/+/, "");
  const url = new URL(relativePath, base);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

async function apiGet(pathname: string, query?: Record<string, string>): Promise<Response> {
  if (!TOKEN) {
    throw new Error("RAINDROP_LIVE_TOKEN is required for live tests");
  }

  return fetch(buildUrl(pathname, query), {
    method: "GET",
    headers: {
      authorization: `Bearer ${TOKEN}`
    }
  });
}

describe("raindrop live api (opt-in)", () => {
  if (!ENABLED || !TOKEN) {
    test("skipped unless RAIN_LIVE_TESTS=1 and RAINDROP_LIVE_TOKEN are set", () => {
      expect(true).toBe(true);
    });
    return;
  }

  test("auth token can read /user", async () => {
    const response = await apiGet("/user");
    expect(response.status).toBe(200);
    const payload = await response.json() as { result?: boolean; user?: { _id?: number; email?: string } };
    expect(payload.result).toBe(true);
    expect(typeof payload.user?._id).toBe("number");
    expect(typeof payload.user?.email).toBe("string");
  });

  test("can read top-level collections", async () => {
    const response = await apiGet("/collections");
    expect(response.status).toBe(200);
    const payload = await response.json() as { result?: boolean; items?: unknown[] };
    expect(payload.result).toBe(true);
    expect(Array.isArray(payload.items)).toBe(true);
  });

  test("can read at least one raindrop page from default collection", async () => {
    const response = await apiGet("/raindrops/0", { perpage: "1", page: "0" });
    expect(response.status).toBe(200);
    const payload = await response.json() as { result?: boolean; items?: unknown[] };
    expect(payload.result).toBe(true);
    expect(Array.isArray(payload.items)).toBe(true);
    expect(payload.items && payload.items.length).toBeGreaterThanOrEqual(0);
  });

  test("cli ls works against live API", async () => {
    const result = await runRain(["ls", "--limit", "1", "--json"], {
      env: {
        RAINDROP_TOKEN: TOKEN,
        RAINDROP_API_BASE: BASE_URL
      }
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const payload = JSON.parse(result.stdout) as { ok?: boolean; data?: unknown };
    expect(payload.ok).toBe(true);
    expect(Array.isArray(payload.data)).toBe(true);
  });
});
