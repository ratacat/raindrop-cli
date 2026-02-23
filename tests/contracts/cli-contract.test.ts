import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { authEnv, expectError, expectSuccess, parseJson } from "../helpers/contract-assert";
import { withMockRaindrop } from "../helpers/mock-raindrop";
import { runRain } from "../helpers/run-rain";

const SAMPLE_BOOKMARK = {
  id: 483920,
  title: "Testing TypeScript APIs",
  link: "https://example.com/article",
  tags: ["api", "testing"],
  collection: { id: 123, title: "Dev" },
  excerpt: "A guide to...",
  type: "article",
  created: "2024-06-15T10:30:00Z",
  important: false
};

function withTempHome(callback: (homeDir: string) => void): void {
  const homeDir = mkdtempSync(join(tmpdir(), "rain-home-"));
  try {
    callback(homeDir);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
}

describe("rain cli contract", () => {
  describe("global behavior", () => {
    test("returns INVALID_ARGS + exit 2 for unknown flags", () => {
      const result = runRain(["search", "typescript", "--wat", "--json"]);
      expectError(result, "INVALID_ARGS", 2);
    });

    test("returns INVALID_ARGS + exit 2 for malformed numeric ids", () => {
      const result = runRain(["get", "abc123", "--json"]);
      expectError(result, "INVALID_ARGS", 2);
    });

    test("returns INVALID_ARGS + exit 2 for malformed timestamps", () => {
      const result = runRain(["watch", "--since", "yesterday", "--json"]);
      expectError(result, "INVALID_ARGS", 2);
    });

    test("uses INVALID_ARGS for unknown commands", () => {
      const result = runRain(["this-command-does-not-exist", "--json"]);
      expectError(result, "INVALID_ARGS", 2);
    });

    test("forces JSON envelope with --json", () => {
      const result = runRain(["robot-docs", "--json"]);
      const payload = parseJson(result) as { ok: boolean; data?: unknown };
      expect(payload.ok).toBe(true);
      expect(payload).toHaveProperty("data");
      expect(result.stdout.startsWith("{")).toBe(true);
    });

    test("error envelopes include message and suggest guidance", () => {
      const result = runRain(["this-command-does-not-exist", "--json"]);
      const payload = parseJson(result) as {
        ok: boolean;
        error: { code: string; message: string; suggest?: string[] };
      };
      expect(payload.ok).toBe(false);
      expect(typeof payload.error.message).toBe("string");
      expect(payload.error.message.length).toBeGreaterThan(0);
      expect(Array.isArray(payload.error.suggest)).toBe(true);
      expect(payload.error.suggest?.length ?? 0).toBeGreaterThan(0);
    });

    test("rejects unsupported flag combinations with INVALID_ARGS", () => {
      const result = runRain(["tags", "--ids-only", "--json"]);
      expectError(result, "INVALID_ARGS", 2);
    });
  });

  describe("auth + config", () => {
    test("returns AUTH_MISSING + exit 3 when no token source exists", async () => {
      await withMockRaindrop(async (server) => {
        const result = runRain(["search", "typescript", "--json"], {
          env: {
            RAINDROP_TOKEN: undefined,
            RAINDROP_API_BASE: server.baseUrl
          }
        });

        expectError(result, "AUTH_MISSING", 3);
        expect(server.requests.length).toBe(0);
      });
    });

    test("uses RAINDROP_TOKEN from env for API calls", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", (request) => {
          expect(request.headers.get("authorization")).toBe("Bearer env-token");
          return {
            json: { items: [SAMPLE_BOOKMARK], count: 1 }
          };
        });

        const result = runRain(["search", "typescript", "--json"], {
          env: authEnv(server.baseUrl, "env-token")
        });

        expectSuccess(result);
        expect(server.requests.length).toBeGreaterThan(0);
      });
    });

    test("falls back to ~/.config/rain/token file when env is absent", async () => {
      await withMockRaindrop(async (server) => {
        withTempHome((homeDir) => {
          const configDir = join(homeDir, ".config", "rain");
          mkdirSync(configDir, { recursive: true });
          writeFileSync(join(configDir, "token"), "file-token\n", "utf8");

          server.all("/*", (request) => {
            expect(request.headers.get("authorization")).toBe("Bearer file-token");
            return { json: { items: [SAMPLE_BOOKMARK], count: 1 } };
          });

          const result = runRain(["search", "typescript", "--json"], {
            env: {
              HOME: homeDir,
              RAINDROP_TOKEN: undefined,
              RAINDROP_API_BASE: server.baseUrl
            }
          });

          expectSuccess(result);
        });
      });
    });

    test("prefers env token over token file when both exist", async () => {
      await withMockRaindrop(async (server) => {
        withTempHome((homeDir) => {
          const configDir = join(homeDir, ".config", "rain");
          mkdirSync(configDir, { recursive: true });
          writeFileSync(join(configDir, "token"), "file-token\n", "utf8");

          server.all("/*", (request) => {
            expect(request.headers.get("authorization")).toBe("Bearer env-token");
            return { json: { items: [SAMPLE_BOOKMARK], count: 1 } };
          });

          const result = runRain(["search", "typescript", "--json"], {
            env: {
              HOME: homeDir,
              RAINDROP_TOKEN: "env-token",
              RAINDROP_API_BASE: server.baseUrl
            }
          });

          expectSuccess(result);
        });
      });
    });
  });

  describe("search", () => {
    test("returns success envelope with data[] and meta", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", () => ({
          json: { items: [SAMPLE_BOOKMARK], count: 1, page: 0 }
        }));

        const result = runRain(["search", "typescript testing", "--json"], {
          env: authEnv(server.baseUrl)
        });

        const payload = expectSuccess(result);
        expect(Array.isArray(payload.data)).toBe(true);
      });
    });

    test("defaults sort to score for text queries", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", (request) => {
          expect(request.query.get("sort")).toBe("score");
          return { json: { items: [], count: 0, page: 0 } };
        });

        const result = runRain(["search", "typescript testing", "--json"], {
          env: authEnv(server.baseUrl)
        });

        const payload = expectSuccess(result);
        expect(payload.data).toEqual([]);
      });
    });

    test("defaults sort to -created for operator-only queries", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", (request) => {
          expect(request.query.get("sort")).toBe("-created");
          return { json: { items: [], count: 0, page: 0 } };
        });

        const result = runRain(["search", "#api", "--json"], {
          env: authEnv(server.baseUrl)
        });

        expectSuccess(result);
      });
    });

    test("honors --sort override and --collection", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", (request) => {
          expect(request.query.get("sort")).toBe("-created");
          expect(request.query.get("collection")).toBe("12345");
          return { json: { items: [SAMPLE_BOOKMARK], count: 1, page: 0 } };
        });

        const result = runRain(["search", "typescript", "--sort", "-created", "--collection", "12345", "--json"], {
          env: authEnv(server.baseUrl)
        });

        expectSuccess(result);
      });
    });

    test("honors --limit and --page parameters", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", (request) => {
          expect(request.query.get("limit")).toBe("10");
          expect(request.query.get("page")).toBe("2");
          return { json: { items: [SAMPLE_BOOKMARK], count: 1, page: 2 } };
        });

        const result = runRain(["search", "typescript", "--limit", "10", "--page", "2", "--json"], {
          env: authEnv(server.baseUrl)
        });

        expectSuccess(result);
      });
    });

    test("search with no matches remains success exit 0 with empty data", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", () => ({ json: { items: [], count: 0, page: 0 } }));
        const result = runRain(["search", "nothing-should-match", "--json"], {
          env: authEnv(server.baseUrl)
        });
        const payload = expectSuccess(result);
        expect(payload.data).toEqual([]);
      });
    });

    test("search forwards --fields projection to API", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", (request) => {
          expect(request.query.get("fields")).toBe("id,title,link");
          return { json: { items: [{ id: SAMPLE_BOOKMARK.id, title: SAMPLE_BOOKMARK.title, link: SAMPLE_BOOKMARK.link }], count: 1, page: 0 } };
        });
        const result = runRain(["search", "typescript", "--fields", "id,title,link", "--json"], {
          env: authEnv(server.baseUrl)
        });
        expectSuccess(result);
      });
    });
  });

  describe("get", () => {
    test("returns a single bookmark by id", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/raindrop/*", () => ({ json: { item: SAMPLE_BOOKMARK } }));
        const result = runRain(["get", "483920", "--json"], { env: authEnv(server.baseUrl) });
        const payload = expectSuccess(result);
        expect(payload.data).toBeTruthy();
      });
    });

    test("supports --fields projection", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/raindrop/*", (request) => {
          expect(request.query.get("fields")).toBe("title,link,tags");
          return { json: { item: { title: SAMPLE_BOOKMARK.title, link: SAMPLE_BOOKMARK.link, tags: SAMPLE_BOOKMARK.tags } } };
        });

        const result = runRain(["get", "483920", "--fields", "title,link,tags", "--json"], {
          env: authEnv(server.baseUrl)
        });

        expectSuccess(result);
      });
    });

    test("returns NOT_FOUND + exit 1 when resource is missing", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/raindrop/*", () => ({ status: 404, json: { error: "not found" } }));
        const result = runRain(["get", "999999", "--json"], { env: authEnv(server.baseUrl) });
        expectError(result, "NOT_FOUND", 1);
      });
    });
  });

  describe("add", () => {
    test("creates a bookmark for add <url>", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", () => ({ json: { item: { id: 483921, link: "https://example.com" } } }));
        const result = runRain(["add", "https://example.com", "--json"], {
          env: authEnv(server.baseUrl)
        });
        expectSuccess(result);
      });
    });

    test("passes parse=true when --parse is set", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", (request) => {
          expect(request.query.get("parse")).toBe("true");
          return { json: { item: { id: 1, link: "https://example.com" } } };
        });
        const result = runRain(["add", "https://example.com", "--parse", "--json"], {
          env: authEnv(server.baseUrl)
        });
        expectSuccess(result);
      });
    });

    test("stdin plain-url batch mode reads one URL per line", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", (request) => {
          expect(request.text).toContain("https://a.com");
          expect(request.text).toContain("https://b.com");
          return { json: { items: [{ id: 1, link: "https://a.com" }, { id: 2, link: "https://b.com" }] } };
        });

        const result = runRain(["add", "--tags", "research", "--json"], {
          env: authEnv(server.baseUrl),
          stdin: "https://a.com\nhttps://b.com\n"
        });
        expectSuccess(result);
      });
    });

    test("add --from-suggest uses suggested collection and tags when present", async () => {
      await withMockRaindrop(async (server) => {
        server.on("GET", "/suggest", () => ({
          json: {
            collections: [{ id: 777 }],
            tags: ["typescript", "testing"]
          }
        }));
        server.on("POST", "/raindrop", (request) => {
          expect(request.text).toContain("\"collection\":777");
          expect(request.text).toContain("\"tags\":[\"typescript\",\"testing\"]");
          return { json: { item: { id: 7777, link: "https://example.com/article" } } };
        });

        const result = runRain(["add", "https://example.com/article", "--from-suggest", "--json"], {
          env: authEnv(server.baseUrl)
        });

        expectSuccess(result);
        expect(server.count("GET", "/suggest")).toBe(1);
        expect(server.count("POST", "/raindrop")).toBe(1);
      });
    });

    test("add --from-suggest falls back to normal add when suggestions are empty", async () => {
      await withMockRaindrop(async (server) => {
        server.on("GET", "/suggest", () => ({
          json: {
            collections: [],
            tags: []
          }
        }));
        server.on("POST", "/raindrop", (request) => {
          expect(request.text).not.toContain("\"collection\":");
          return { json: { item: { id: 9999, link: "https://example.com/fallback" } } };
        });

        const result = runRain(["add", "https://example.com/fallback", "--from-suggest", "--json"], {
          env: authEnv(server.baseUrl)
        });

        expectSuccess(result);
      });
    });

    test("stdin JSONL mode preserves per-item metadata", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", (request) => {
          expect(request.text).toContain("\"collection\":123");
          expect(request.text).toContain("\"tags\":[\"docs\"]");
          return { json: { items: [{ id: 1, link: "https://a.com" }, { id: 2, link: "https://b.com" }] } };
        });

        const result = runRain(["add", "--json"], {
          env: authEnv(server.baseUrl),
          stdin: '{"link":"https://a.com","tags":["api"]}\n{"link":"https://b.com","tags":["docs"],"collection":123}\n'
        });
        expectSuccess(result);
      });
    });

    test("stdin format auto-detect trims whitespace before JSONL detection", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", (request) => {
          expect(request.text).toContain("\"tags\":[\"api\"]");
          return { json: { items: [{ id: 1, link: "https://trimmed-jsonl.com" }] } };
        });

        const result = runRain(["add", "--json"], {
          env: authEnv(server.baseUrl),
          stdin: '   {"link":"https://trimmed-jsonl.com","tags":["api"]}\n'
        });
        expectSuccess(result);
      });
    });

    test("chunks batch add requests at 100 items", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", () => ({ json: { items: [] } }));
        const stdin = Array.from({ length: 205 }, (_, index) => `https://example.com/${index}`).join("\n");
        const result = runRain(["add", "--json"], {
          env: authEnv(server.baseUrl),
          stdin
        });
        expectSuccess(result);
        expect(server.requests.length).toBe(3);
      });
    });

    test("does not chunk when batch size is exactly 100", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", () => ({ json: { items: [] } }));
        const stdin = Array.from({ length: 100 }, (_, index) => `https://exact-100.com/${index}`).join("\n");
        const result = runRain(["add", "--json"], {
          env: authEnv(server.baseUrl),
          stdin
        });
        expectSuccess(result);
        expect(server.requests.length).toBe(1);
      });
    });
  });

  describe("update", () => {
    test("updates scalar fields", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/raindrop/*", (request) => {
          expect(request.text).toContain("\"title\":\"New Title\"");
          return { json: { item: { ...SAMPLE_BOOKMARK, title: "New Title" } } };
        });
        const result = runRain(["update", "483920", "--title", "New Title", "--json"], {
          env: authEnv(server.baseUrl)
        });
        expectSuccess(result);
      });
    });

    test("supports tag algebra +add,-remove using read-modify-write", async () => {
      await withMockRaindrop(async (server) => {
        server.on("GET", "/raindrop/483920", () => ({ json: { item: SAMPLE_BOOKMARK } }));
        server.on("PUT", "/raindrop/483920", (request) => {
          expect(request.text).toContain("\"tags\":[\"api\",\"new\"]");
          return { json: { item: { ...SAMPLE_BOOKMARK, tags: ["api", "new"] } } };
        });

        const result = runRain(["update", "483920", "--tags", "+new,-testing", "--json"], {
          env: authEnv(server.baseUrl)
        });

        expectSuccess(result);
        expect(server.count("GET", "/raindrop/483920")).toBe(1);
        expect(server.count("PUT", "/raindrop/483920")).toBe(1);
      });
    });

    test("supports tag replacement with =prefix in one call", async () => {
      await withMockRaindrop(async (server) => {
        server.on("PUT", "/raindrop/483920", (request) => {
          expect(request.text).toContain("\"tags\":[\"only\",\"these\"]");
          return { json: { item: { ...SAMPLE_BOOKMARK, tags: ["only", "these"] } } };
        });

        const result = runRain(["update", "483920", "--tags", "=only,these", "--json"], {
          env: authEnv(server.baseUrl)
        });

        expectSuccess(result);
        expect(server.count("PUT", "/raindrop/483920")).toBe(1);
      });
    });

    test("supports stdin batch update ids with +tag append", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", (request) => {
          expect(request.text).toContain("\"ids\":[1,2,3]");
          expect(request.text).toContain("\"tags\":[\"needs-review\"]");
          return { json: { result: true } };
        });

        const result = runRain(["update", "--tags", "+needs-review", "--json"], {
          env: authEnv(server.baseUrl),
          stdin: "1\n2\n3\n"
        });

        expectSuccess(result);
      });
    });

    test("update returns NOT_FOUND + exit 1 for missing resource", async () => {
      await withMockRaindrop(async (server) => {
        server.on("PUT", "/raindrop/999999", () => ({ status: 404, json: { error: "not found" } }));
        const result = runRain(["update", "999999", "--title", "Missing", "--json"], {
          env: authEnv(server.baseUrl)
        });
        expectError(result, "NOT_FOUND", 1);
      });
    });

    test("batch stdin mode rejects -remove/=replace tag operations", () => {
      const removeResult = runRain(["update", "--tags", "-legacy", "--json"], {
        stdin: "1\n2\n3\n"
      });
      expectError(removeResult, "INVALID_ARGS", 2);

      const replaceResult = runRain(["update", "--tags", "=only,these", "--json"], {
        stdin: "1\n2\n3\n"
      });
      expectError(replaceResult, "INVALID_ARGS", 2);
    });
  });

  describe("rm", () => {
    test("moves bookmark to trash by default", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", () => ({ json: { result: true } }));
        const result = runRain(["rm", "483920", "--json"], { env: authEnv(server.baseUrl) });
        expectSuccess(result);
      });
    });

    test("permanent delete performs trash-then-delete flow", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", () => ({ json: { result: true } }));
        const result = runRain(["rm", "483920", "--permanent", "--json"], { env: authEnv(server.baseUrl) });
        expectSuccess(result);
        expect(server.requests.length).toBeGreaterThanOrEqual(1);
      });
    });

    test("returns NOT_FOUND + exit 1 for missing bookmark", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", () => ({ status: 404, json: { error: "not found" } }));
        const result = runRain(["rm", "999999", "--json"], { env: authEnv(server.baseUrl) });
        expectError(result, "NOT_FOUND", 1);
      });
    });
  });

  describe("ls", () => {
    test("defaults to first 25 results", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", (request) => {
          expect(request.query.get("limit")).toBe("25");
          return { json: { items: [SAMPLE_BOOKMARK], count: 1, page: 0 } };
        });
        const result = runRain(["ls", "--json"], { env: authEnv(server.baseUrl) });
        expectSuccess(result);
      });
    });

    test("auto-paginates with --all", async () => {
      await withMockRaindrop(async (server) => {
        let page = 0;
        server.all("/*", () => {
          const payload = page < 2 ? { items: [SAMPLE_BOOKMARK], count: 1, page } : { items: [], count: 0, page };
          page += 1;
          return { json: payload };
        });
        const result = runRain(["ls", "--all", "--json"], { env: authEnv(server.baseUrl) });
        const payload = expectSuccess(result);
        expect(Array.isArray(payload.data)).toBe(true);
        expect(server.requests.length).toBe(3);
      });
    });

    test("maps filter flags to search semantics", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", (request) => {
          const search = request.query.get("search") ?? "";
          expect(search).toContain("#api");
          expect(search).toContain("type:article");
          expect(search).toContain("notag:true");
          return { json: { items: [SAMPLE_BOOKMARK], count: 1, page: 0 } };
        });

        const result = runRain(["ls", "--tag", "api", "--type", "article", "--notag", "--json"], {
          env: authEnv(server.baseUrl)
        });
        expectSuccess(result);
      });
    });

    test("supports positional collection id scope", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", (request) => {
          expect(request.query.get("collection")).toBe("123");
          return { json: { items: [SAMPLE_BOOKMARK], count: 1, page: 0 } };
        });
        const result = runRain(["ls", "123", "--json"], { env: authEnv(server.baseUrl) });
        expectSuccess(result);
      });
    });

    test("maps --important to important:true search operator", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", (request) => {
          expect(request.query.get("search")).toContain("important:true");
          return { json: { items: [SAMPLE_BOOKMARK], count: 1, page: 0 } };
        });
        const result = runRain(["ls", "--important", "--json"], { env: authEnv(server.baseUrl) });
        expectSuccess(result);
      });
    });

    test("applies --broken as a client-side filter", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", () => ({
          json: {
            items: [
              { ...SAMPLE_BOOKMARK, id: 1, broken: true },
              { ...SAMPLE_BOOKMARK, id: 2, broken: false }
            ],
            count: 2,
            page: 0
          }
        }));
        const result = runRain(["ls", "--broken", "--json"], { env: authEnv(server.baseUrl) });
        const payload = expectSuccess(result);
        expect(payload.data).toEqual([expect.objectContaining({ id: 1, broken: true })]);
      });
    });

    test("returns number[] in --ids-only mode", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", () => ({ json: { items: [{ id: 1 }, { id: 2 }] } }));
        const result = runRain(["ls", "--ids-only", "--json"], { env: authEnv(server.baseUrl) });
        const payload = expectSuccess(result);
        expect(payload.data).toEqual([1, 2]);
      });
    });
  });

  describe("collections + tags + status", () => {
    test("collections supports flat and tree outputs", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", () => ({
          json: {
            items: [
              { id: 123, title: "Dev", count: 42, parent: null },
              { id: 456, title: "APIs", count: 15, parent: 123 }
            ]
          }
        }));

        const flat = runRain(["collections", "--json"], { env: authEnv(server.baseUrl) });
        const tree = runRain(["collections", "--tree", "--json"], { env: authEnv(server.baseUrl) });
        expectSuccess(flat);
        expectSuccess(tree);
      });
    });

    test("collections --ids-only returns only numeric ids", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", () => ({
          json: {
            items: [
              { id: 123, title: "Dev", count: 42, parent: null },
              { id: 456, title: "APIs", count: 15, parent: 123 }
            ]
          }
        }));
        const result = runRain(["collections", "--ids-only", "--json"], { env: authEnv(server.baseUrl) });
        const payload = expectSuccess(result);
        expect(payload.data).toEqual([123, 456]);
      });
    });

    test("tags sorts by count or name", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", () => ({ json: { items: [{ tag: "testing", count: 42 }, { tag: "api", count: 100 }] } }));
        const byCount = runRain(["tags", "--sort", "count", "--json"], { env: authEnv(server.baseUrl) });
        const byName = runRain(["tags", "--sort", "name", "--json"], { env: authEnv(server.baseUrl) });
        const countPayload = expectSuccess(byCount);
        const namePayload = expectSuccess(byName);
        expect(Array.isArray(countPayload.data)).toBe(true);
        expect(Array.isArray(namePayload.data)).toBe(true);
      });
    });

    test("tags supports collection scoping via positional id", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", (request) => {
          expect(request.query.get("collection")).toBe("123");
          return { json: { items: [{ tag: "api", count: 1 }] } };
        });
        const result = runRain(["tags", "123", "--json"], { env: authEnv(server.baseUrl) });
        expectSuccess(result);
      });
    });

    test("status includes totals, duplicates, broken, lastChanged", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", () => ({
          json: {
            total: 1570,
            unsorted: 34,
            trash: 543,
            pro: true,
            broken: 31,
            duplicates: 3,
            lastChanged: "2024-06-15T10:30:00Z"
          }
        }));
        const result = runRain(["status", "--json"], { env: authEnv(server.baseUrl) });
        const payload = expectSuccess(result);
        expect(payload.data).toMatchObject({
          total: 1570,
          broken: 31,
          duplicates: 3,
          lastChanged: "2024-06-15T10:30:00Z"
        });
      });
    });
  });

  describe("collection CRUD", () => {
    test("creates collection with optional parent/public", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", (request) => {
          expect(request.text).toContain("\"title\":\"Research\"");
          expect(request.text).toContain("\"parent\":123");
          expect(request.text).toContain("\"public\":true");
          return { json: { item: { id: 900, title: "Research" } } };
        });
        const result = runRain(["collection", "create", "Research", "--parent", "123", "--public", "--json"], {
          env: authEnv(server.baseUrl)
        });
        expectSuccess(result);
      });
    });

    test("updates collection title/parent/view", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", (request) => {
          expect(request.text).toContain("\"title\":\"New Name\"");
          expect(request.text).toContain("\"parent\":456");
          expect(request.text).toContain("\"view\":\"grid\"");
          return { json: { item: { id: 123, title: "New Name" } } };
        });
        const result = runRain(
          ["collection", "update", "123", "--title", "New Name", "--parent", "456", "--view", "grid", "--json"],
          { env: authEnv(server.baseUrl) }
        );
        expectSuccess(result);
      });
    });

    test("deletes a collection tree", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", () => ({ json: { result: true } }));
        const result = runRain(["collection", "rm", "123", "--json"], { env: authEnv(server.baseUrl) });
        expectSuccess(result);
      });
    });

    test("collection rm returns NOT_FOUND + exit 1 when missing", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", () => ({ status: 404, json: { error: "not found" } }));
        const result = runRain(["collection", "rm", "999999", "--json"], { env: authEnv(server.baseUrl) });
        expectError(result, "NOT_FOUND", 1);
      });
    });
  });

  describe("robot-docs", () => {
    test("returns schema with commands, flags, exit codes, and auth hints", () => {
      const result = runRain(["robot-docs", "--json"]);
      const payload = expectSuccess(result);
      expect(payload.data).toMatchObject({
        commands: expect.any(Object),
        common_flags: expect.any(Array),
        exit_codes: expect.any(Object),
        auth: expect.any(String)
      });
    });
  });

  describe("exists + suggest", () => {
    test("exists single URL returns exit 0 when found", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", () => ({ json: { found: { id: 483920 } } }));
        const result = runRain(["exists", "https://example.com", "--json"], {
          env: authEnv(server.baseUrl)
        });
        const payload = expectSuccess(result, 0);
        expect(payload.data).toEqual({ id: 483920 });
      });
    });

    test("exists single URL returns exit 1 with ok=true and data=null when missing", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", () => ({ json: { found: null } }));
        const result = runRain(["exists", "https://not-saved.com", "--json"], {
          env: authEnv(server.baseUrl)
        });
        const payload = expectSuccess(result, 1);
        expect(payload.data).toBeNull();
      });
    });

    test("exists batch mode always exits 0 with per-url id/null results", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", (request) => {
          expect(request.text).toContain("https://a.com");
          expect(request.text).toContain("https://b.com");
          return {
            json: {
              items: [
                { link: "https://a.com", id: 483920 },
                { link: "https://b.com", id: null }
              ]
            }
          };
        });

        const result = runRain(["exists", "--json"], {
          env: authEnv(server.baseUrl),
          stdin: "https://a.com\nhttps://b.com\n"
        });

        const payload = expectSuccess(result, 0);
        expect(payload.data).toEqual([
          { link: "https://a.com", id: 483920 },
          { link: "https://b.com", id: null }
        ]);
      });
    });

    test("exists normalizes obvious URL variants before lookup", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", (request) => {
          const queryUrl = request.query.get("url") ?? "";
          expect(queryUrl).toBe("https://example.com/path");
          return { json: { found: { id: 483920 } } };
        });

        const result = runRain(["exists", "http://example.com/path/?utm_source=x", "--json"], {
          env: authEnv(server.baseUrl)
        });
        expectSuccess(result, 0);
      });
    });

    test("suggest returns collections[] and tags[]", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", () => ({
          json: {
            collections: [{ id: 123 }],
            tags: ["typescript", "testing"]
          }
        }));
        const result = runRain(["suggest", "https://example.com/article", "--json"], {
          env: authEnv(server.baseUrl)
        });
        const payload = expectSuccess(result);
        expect(payload.data).toMatchObject({
          collections: [{ id: 123 }],
          tags: ["typescript", "testing"]
        });
      });
    });

    test("suggest rejects malformed urls with INVALID_ARGS + exit 2", () => {
      const result = runRain(["suggest", "not-a-url", "--json"]);
      expectError(result, "INVALID_ARGS", 2);
    });
  });

  describe("highlights + export + watch", () => {
    test("highlights applies client-side --color filter", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", () => ({
          json: {
            items: [
              { id: "a", color: "yellow", text: "A" },
              { id: "b", color: "green", text: "B" }
            ]
          }
        }));
        const result = runRain(["highlights", "--color", "yellow", "--json"], {
          env: authEnv(server.baseUrl)
        });
        const payload = expectSuccess(result);
        expect(payload.data).toEqual([{ id: "a", color: "yellow", text: "A" }]);
      });
    });

    test("highlights forwards --limit to API query", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", (request) => {
          expect(request.query.get("limit")).toBe("50");
          return { json: { items: [] } };
        });
        const result = runRain(["highlights", "--limit", "50", "--json"], {
          env: authEnv(server.baseUrl)
        });
        expectSuccess(result);
      });
    });

    test("export --format csv returns csv text output", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", () => ({ json: { items: [SAMPLE_BOOKMARK], count: 1, page: 0 } }));
        const result = runRain(["export", "--format", "csv", "--fields", "id,title,link", "--json"], {
          env: authEnv(server.baseUrl)
        });
        const payload = expectSuccess(result);
        expect(typeof payload.data).toBe("string");
        expect(payload.data).toContain("id,title,link");
      });
    });

    test("export supports positional collection id scope", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", (request) => {
          expect(request.query.get("collection")).toBe("123");
          return { json: { items: [SAMPLE_BOOKMARK], count: 1, page: 0 } };
        });
        const result = runRain(["export", "123", "--json"], {
          env: authEnv(server.baseUrl)
        });
        expectSuccess(result);
      });
    });

    test("export rejects --fields when format is csv", () => {
      const result = runRain(["export", "--format", "csv", "--fields", "id,title", "--json"]);
      expectError(result, "INVALID_ARGS", 2);
    });

    test("watch returns only items modified after --since cutoff", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", () => ({
          json: {
            items: [
              { ...SAMPLE_BOOKMARK, id: 1, lastUpdate: "2024-06-15T12:00:00Z" },
              { ...SAMPLE_BOOKMARK, id: 2, lastUpdate: "2024-06-14T01:00:00Z" }
            ]
          }
        }));
        const result = runRain(["watch", "--since", "2024-06-15T00:00:00Z", "--json"], {
          env: authEnv(server.baseUrl)
        });
        const payload = expectSuccess(result);
        expect(payload.data).toEqual([
          expect.objectContaining({ id: 1 })
        ]);
      });
    });

    test("watch supports optional collection scope", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", (request) => {
          expect(request.query.get("collection")).toBe("123");
          return { json: { items: [] } };
        });
        const result = runRain(["watch", "--since", "2024-06-15T00:00:00Z", "--collection", "123", "--json"], {
          env: authEnv(server.baseUrl)
        });
        expectSuccess(result);
      });
    });

    test("watch requests sorted by -lastUpdate", async () => {
      await withMockRaindrop(async (server) => {
        server.all("/*", (request) => {
          expect(request.query.get("sort")).toBe("-lastUpdate");
          return { json: { items: [] } };
        });
        const result = runRain(["watch", "--since", "2024-06-15T00:00:00Z", "--json"], {
          env: authEnv(server.baseUrl)
        });
        expectSuccess(result);
      });
    });

    test("watch de-dupes by id when overlap window includes duplicates", async () => {
      await withMockRaindrop(async (server) => {
        let call = 0;
        server.all("/*", () => {
          call += 1;
          if (call === 1) {
            return {
              json: {
                items: [
                  { ...SAMPLE_BOOKMARK, id: 1, lastUpdate: "2024-06-15T12:00:00Z" },
                  { ...SAMPLE_BOOKMARK, id: 2, lastUpdate: "2024-06-15T11:30:00Z" }
                ]
              }
            };
          }
          return {
            json: {
              items: [
                { ...SAMPLE_BOOKMARK, id: 2, lastUpdate: "2024-06-15T11:30:00Z" },
                { ...SAMPLE_BOOKMARK, id: 3, lastUpdate: "2024-06-14T12:00:00Z" }
              ]
            }
          };
        });

        const result = runRain(["watch", "--since", "2024-06-15T00:00:00Z", "--json"], {
          env: authEnv(server.baseUrl)
        });
        const payload = expectSuccess(result);
        expect(payload.data).toEqual([
          expect.objectContaining({ id: 1 }),
          expect.objectContaining({ id: 2 })
        ]);
      });
    });
  });

  describe("error mapping", () => {
    test("maps HTTP 401/403 to AUTH_INVALID + exit 3", async () => {
      await withMockRaindrop(async (server) => {
        server.setFallback(() => ({ status: 401, json: { error: "unauthorized" } }));
        const result = runRain(["search", "typescript", "--json"], {
          env: authEnv(server.baseUrl)
        });
        expectError(result, "AUTH_INVALID", 3);
      });
    });

    test("maps HTTP 429 to RATE_LIMITED + exit 4", async () => {
      await withMockRaindrop(async (server) => {
        server.setFallback(() => ({ status: 429, json: { error: "rate limit" } }));
        const result = runRain(["search", "typescript", "--json"], {
          env: authEnv(server.baseUrl)
        });
        expectError(result, "RATE_LIMITED", 4);
      });
    });

    test("maps HTTP 5xx to API_ERROR + exit 5", async () => {
      await withMockRaindrop(async (server) => {
        server.setFallback(() => ({ status: 500, json: { error: "boom" } }));
        const result = runRain(["search", "typescript", "--json"], {
          env: authEnv(server.baseUrl)
        });
        expectError(result, "API_ERROR", 5);
      });
    });

    test("maps transport failures to NETWORK_ERROR + exit 5", () => {
      const result = runRain(["search", "typescript", "--json"], {
        env: {
          RAINDROP_TOKEN: "test-token",
          RAINDROP_API_BASE: "http://127.0.0.1:9"
        }
      });
      expectError(result, "NETWORK_ERROR", 5);
    });

    test("maps not-found resource lookups to NOT_FOUND + exit 1", async () => {
      await withMockRaindrop(async (server) => {
        server.setFallback(() => ({ status: 404, json: { error: "missing" } }));
        const result = runRain(["get", "999999", "--json"], {
          env: authEnv(server.baseUrl)
        });
        expectError(result, "NOT_FOUND", 1);
      });
    });
  });
});
