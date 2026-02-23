#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const VERSION = "0.1.1";
const DEFAULT_API_BASE = "https://api.raindrop.io/rest/v1";

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

type OutputError = {
  code: string;
  message: string;
  suggest: string[];
};

type FlagType = "boolean" | "string";

type FlagDef = {
  key: string;
  type: FlagType;
};

type ParsedFlags = {
  positionals: string[];
  values: Record<string, string | boolean | undefined>;
};

class CliError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly suggest: string[];

  constructor(code: string, message: string, exitCode: number, suggest: string[]) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
    this.suggest = suggest;
  }
}

class HttpError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(status: number, payload: unknown) {
    super(`HTTP ${status}`);
    this.status = status;
    this.payload = payload;
  }
}

const ERROR_SUGGESTIONS: Record<string, string[]> = {
  AUTH_MISSING: [
    "Set RAINDROP_TOKEN env var",
    "Or create ~/.config/rain/token"
  ],
  AUTH_INVALID: ["Verify your API token and try again"],
  INVALID_ARGS: ["Run `rain help` for command usage"],
  NOT_FOUND: ["Check the provided id/url and try again"],
  RATE_LIMITED: ["Retry with backoff"],
  API_ERROR: ["Retry later; upstream API returned an error"],
  NETWORK_ERROR: ["Check network connectivity and RAINDROP_API_BASE"]
};

function isError(value: unknown): value is Error {
  return value instanceof Error;
}

function fail(code: string, message: string, exitCode: number): never {
  throw new CliError(code, message, exitCode, ERROR_SUGGESTIONS[code] ?? ["Run `rain help`"]);
}

function failInvalid(message: string): never {
  fail("INVALID_ARGS", message, 2);
}

function failNotFound(message: string): never {
  fail("NOT_FOUND", message, 1);
}

function printHelp(): void {
  console.log(`rain ${VERSION}

Usage:
  rain <command> [options]

Core commands:
  search <query>
  get <id>
  add <url>
  update <id>
  rm <id>
  ls [collection]
  collections
  collection create <title>
  collection update <id>
  collection rm <id>
  tags [collection]
  status

Power commands:
  robot-docs
  exists <url>
  suggest <url>
  highlights [collection]
  export [collection]
  watch --since <timestamp>

Global options:
  -h, --help
  -v, --version
  -j, --json
`);
}

function printVersion(): void {
  console.log(VERSION);
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function outputSuccess(data: unknown, meta?: Record<string, unknown>, exitCode = 0): void {
  const out: { ok: true; data: unknown; meta?: Record<string, unknown> } = { ok: true, data };
  if (meta) out.meta = meta;
  printJson(out);
  process.exitCode = exitCode;
}

function outputError(error: OutputError, exitCode: number): void {
  printJson({
    ok: false,
    error
  });
  process.exitCode = exitCode;
}

function parseGlobal(argv: string[]): { commandArgs: string[]; forceJson: boolean } {
  const commandArgs: string[] = [];
  let forceJson = false;

  for (const token of argv) {
    if (token === "--json" || token === "-j") {
      forceJson = true;
      continue;
    }
    commandArgs.push(token);
  }

  return { commandArgs, forceJson };
}

function parseFlags(args: string[], defs: Record<string, FlagDef>): ParsedFlags {
  const values: Record<string, string | boolean | undefined> = {};
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (typeof token !== "string") {
      continue;
    }

    if (!token.startsWith("-")) {
      positionals.push(token);
      continue;
    }

    const def = defs[token];
    if (!def) {
      failInvalid(`Unknown flag: ${token}`);
    }

    if (def.type === "boolean") {
      values[def.key] = true;
      continue;
    }

    const next = args[i + 1];
    if (typeof next !== "string") {
      failInvalid(`Missing value for flag: ${token}`);
    }
    values[def.key] = next;
    i += 1;
  }

  return { values, positionals };
}

function requirePositional(positionals: string[], index: number, message: string): string {
  const value = positionals[index];
  if (typeof value !== "string") {
    failInvalid(message);
  }
  return value;
}

function parseInteger(value: string, fieldName: string): number {
  if (!/^\d+$/.test(value)) {
    failInvalid(`${fieldName} must be a positive integer`);
  }
  return Number(value);
}

function parseOptionalInteger(value: string | boolean | undefined, fieldName: string): number | undefined {
  if (typeof value !== "string") return undefined;
  return parseInteger(value, fieldName);
}

function parseBooleanLiteral(value: string, fieldName: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  failInvalid(`${fieldName} must be true or false`);
}

function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

function validateUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    failInvalid(`Invalid URL: ${url}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    failInvalid(`Invalid URL protocol for: ${url}`);
  }

  return parsed;
}

function normalizeUrl(rawUrl: string): string {
  const url = validateUrl(rawUrl);
  url.protocol = "https:";
  url.hash = "";

  const keysToDelete: string[] = [];
  for (const key of url.searchParams.keys()) {
    if (key.toLowerCase().startsWith("utm_")) {
      keysToDelete.push(key);
    }
  }
  for (const key of keysToDelete) {
    url.searchParams.delete(key);
  }

  while (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.toString();
}

function parseIsoTimestamp(value: string): number {
  // Require explicit UTC designator to avoid timezone ambiguity.
  if (!value.endsWith("Z")) {
    failInvalid("Timestamp must be ISO 8601 UTC (example: 2024-06-15T00:00:00Z)");
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    failInvalid("Timestamp must be ISO 8601 UTC (example: 2024-06-15T00:00:00Z)");
  }
  return ms;
}

function readTokenFromFile(): string | undefined {
  const home = process.env.HOME;
  if (!home) return undefined;
  const tokenPath = join(home, ".config", "rain", "token");
  if (!existsSync(tokenPath)) return undefined;
  const token = readFileSync(tokenPath, "utf8").trim();
  return token.length > 0 ? token : undefined;
}

function requireToken(): string {
  const envToken = process.env.RAINDROP_TOKEN?.trim();
  if (envToken) return envToken;

  const fileToken = readTokenFromFile();
  if (fileToken) return fileToken;

  fail("AUTH_MISSING", "No API token found", 3);
}

function apiBaseUrl(): string {
  const configured = process.env.RAINDROP_API_BASE?.trim();
  if (configured && configured.length > 0) {
    return configured;
  }
  return DEFAULT_API_BASE;
}

function buildUrl(pathname: string, query?: Record<string, string | number | boolean | undefined>): URL {
  const base = apiBaseUrl();
  const normalizedPath = pathname.replace(/^\/+/, "");
  const url = new URL(normalizedPath, base.endsWith("/") ? base : `${base}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === "undefined") continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

async function requestJson(
  method: string,
  pathname: string,
  token: string,
  options?: {
    query?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
    rawBody?: string;
  }
): Promise<unknown> {
  const url = buildUrl(pathname, options?.query);
  const headers = new Headers();
  headers.set("authorization", `Bearer ${token}`);

  let body: string | undefined;
  if (typeof options?.rawBody === "string") {
    body = options.rawBody;
    headers.set("content-type", "text/plain");
  } else if (typeof options?.body !== "undefined") {
    body = JSON.stringify(options.body);
    headers.set("content-type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body
    });
  } catch (error) {
    if (isError(error)) {
      fail("NETWORK_ERROR", error.message, 5);
    }
    fail("NETWORK_ERROR", "Network request failed", 5);
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text.trim().length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    throw new HttpError(response.status, payload);
  }

  return payload;
}

function mapHttpError(error: unknown): never {
  if (error instanceof CliError) {
    throw error;
  }
  if (error instanceof HttpError) {
    if (error.status === 401 || error.status === 403) {
      fail("AUTH_INVALID", "API token was rejected", 3);
    }
    if (error.status === 404) {
      failNotFound("Requested resource was not found");
    }
    if (error.status === 429) {
      fail("RATE_LIMITED", "Rate limit reached", 4);
    }
    fail("API_ERROR", `API request failed with status ${error.status}`, 5);
  }

  if (isError(error)) {
    fail("API_ERROR", error.message, 5);
  }
  fail("API_ERROR", "Unexpected API error", 5);
}

function extractItems(payload: unknown): unknown[] {
  if (payload && typeof payload === "object" && "items" in payload) {
    const items = (payload as { items?: unknown }).items;
    if (Array.isArray(items)) return items;
  }
  return [];
}

function extractItem(payload: unknown): unknown {
  if (payload && typeof payload === "object" && "item" in payload) {
    return (payload as { item: unknown }).item;
  }
  return payload;
}

function readStdinText(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function readStdinLines(): string[] {
  return readStdinText()
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function applyFieldsProjection<T extends Record<string, unknown>>(items: T[], fields: string[]): Record<string, unknown>[] {
  return items.map((item) => {
    const out: Record<string, unknown> = {};
    for (const field of fields) {
      if (field in item) {
        out[field] = item[field];
      }
    }
    return out;
  });
}

function toCsv(data: unknown[], fields: string[]): string {
  const rows: string[] = [];
  rows.push(fields.join(","));

  for (const row of data) {
    const obj = (row ?? {}) as Record<string, unknown>;
    const values = fields.map((field) => {
      const value = obj[field];
      if (Array.isArray(value)) return `"${value.map((part) => String(part)).join(";")}"`;
      if (value && typeof value === "object") return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
      const text = value == null ? "" : String(value);
      if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
        return `"${text.replace(/"/g, '""')}"`;
      }
      return text;
    });
    rows.push(values.join(","));
  }

  return rows.join("\n");
}

function parseSearchMode(query: string): "score" | "-created" {
  const trimmed = query.trim();
  if (trimmed.startsWith("#") || trimmed.includes(":")) {
    return "-created";
  }
  return "score";
}

async function cmdSearch(args: string[]): Promise<void> {
  const parsed = parseFlags(args, {
    "--collection": { key: "collection", type: "string" },
    "--sort": { key: "sort", type: "string" },
    "--limit": { key: "limit", type: "string" },
    "--page": { key: "page", type: "string" },
    "--fields": { key: "fields", type: "string" }
  });

  if (parsed.positionals.length !== 1) {
    failInvalid("search requires exactly one <query>");
  }

  const query = requirePositional(parsed.positionals, 0, "search requires exactly one <query>");
  const token = requireToken();
  const collection = parseOptionalInteger(parsed.values.collection, "collection");
  const limit = parseOptionalInteger(parsed.values.limit, "limit");
  const page = parseOptionalInteger(parsed.values.page, "page");
  const sort = typeof parsed.values.sort === "string" ? parsed.values.sort : parseSearchMode(query);
  const fields = typeof parsed.values.fields === "string" ? parsed.values.fields : undefined;

  try {
    const response = await requestJson("GET", "/search", token, {
      query: {
        q: query,
        sort,
        collection,
        limit,
        page,
        fields
      }
    });

    const items = extractItems(response);
    const responseObj = response as { count?: number; page?: number };
    outputSuccess(items, {
      count: typeof responseObj.count === "number" ? responseObj.count : items.length,
      page: typeof responseObj.page === "number" ? responseObj.page : page ?? 0,
      total: typeof responseObj.count === "number" ? responseObj.count : items.length
    });
  } catch (error) {
    mapHttpError(error);
  }
}

async function cmdGet(args: string[]): Promise<void> {
  const parsed = parseFlags(args, {
    "--fields": { key: "fields", type: "string" }
  });

  if (parsed.positionals.length !== 1) {
    failInvalid("get requires exactly one <id>");
  }

  const id = parseInteger(requirePositional(parsed.positionals, 0, "get requires exactly one <id>"), "id");
  const fields = typeof parsed.values.fields === "string" ? parsed.values.fields : undefined;
  const token = requireToken();

  try {
    const response = await requestJson("GET", `/raindrop/${id}`, token, {
      query: { fields }
    });
    outputSuccess(extractItem(response));
  } catch (error) {
    mapHttpError(error);
  }
}

function parseAddStdin(lines: string[], shared: { title?: string; tags?: string[]; collection?: number }): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];

  for (const line of lines) {
    if (line.startsWith("{")) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        failInvalid(`Invalid JSONL line: ${line}`);
      }
      if (!parsed || typeof parsed !== "object") {
        failInvalid("JSONL entries must be objects");
      }
      const asObj = parsed as Record<string, unknown>;
      if (typeof asObj.link !== "string" || asObj.link.length === 0) {
        failInvalid("JSONL entries must include link");
      }
      items.push({
        ...asObj,
        ...(shared.title ? { title: shared.title } : {}),
        ...(shared.tags ? { tags: shared.tags } : {}),
        ...(typeof shared.collection === "number" ? { collection: shared.collection } : {})
      });
      continue;
    }

    validateUrl(line);
    items.push({
      link: line,
      ...(shared.title ? { title: shared.title } : {}),
      ...(shared.tags ? { tags: shared.tags } : {}),
      ...(typeof shared.collection === "number" ? { collection: shared.collection } : {})
    });
  }

  return items;
}

async function cmdAdd(args: string[]): Promise<void> {
  const parsed = parseFlags(args, {
    "--title": { key: "title", type: "string" },
    "--tags": { key: "tags", type: "string" },
    "--collection": { key: "collection", type: "string" },
    "--parse": { key: "parse", type: "boolean" },
    "--from-suggest": { key: "fromSuggest", type: "boolean" }
  });

  if (parsed.positionals.length > 1) {
    failInvalid("add accepts at most one positional <url>");
  }

  const title = typeof parsed.values.title === "string" ? parsed.values.title : undefined;
  const tags = typeof parsed.values.tags === "string" ? parseTags(parsed.values.tags) : undefined;
  const collection = parseOptionalInteger(parsed.values.collection, "collection");
  const shouldParse = parsed.values.parse === true;
  const fromSuggest = parsed.values.fromSuggest === true;

  const token = requireToken();

  const singleUrl = parsed.positionals[0];
  if (typeof singleUrl === "string") {
    validateUrl(singleUrl);
    const payload: Record<string, unknown> = {
      link: singleUrl
    };
    if (title) payload.title = title;
    if (tags) payload.tags = tags;
    if (typeof collection === "number") payload.collection = collection;

    if (fromSuggest) {
      try {
        const suggest = await requestJson("GET", "/suggest", token, {
          query: { url: singleUrl }
        }) as { collections?: Array<{ id?: number }>; tags?: string[] };

        if (typeof payload.collection === "undefined" && Array.isArray(suggest.collections) && suggest.collections[0]?.id) {
          payload.collection = suggest.collections[0].id;
        }
        if (Array.isArray(suggest.tags) && suggest.tags.length > 0) {
          const current = Array.isArray(payload.tags) ? (payload.tags as string[]) : [];
          payload.tags = Array.from(new Set([...suggest.tags, ...current]));
        }
      } catch {
        // Best-effort suggest mode: proceed with regular add if suggest endpoint fails.
      }
    }

    try {
      const response = await requestJson("POST", "/raindrop", token, {
        query: shouldParse ? { parse: true } : undefined,
        body: payload
      });
      outputSuccess(extractItem(response));
      return;
    } catch (error) {
      mapHttpError(error);
    }
  }

  const lines = readStdinLines();
  if (lines.length === 0) {
    failInvalid("add requires either <url> or stdin input");
  }

  const shared = { title, tags, collection };
  const items = parseAddStdin(lines, shared);
  const chunks = chunk(items, 100);
  const merged: unknown[] = [];

  try {
    for (const chunkItems of chunks) {
      const response = await requestJson("POST", "/raindrop/multi", token, {
        query: shouldParse ? { parse: true } : undefined,
        body: { items: chunkItems }
      });
      const responseItems = extractItems(response);
      if (responseItems.length > 0) {
        merged.push(...responseItems);
      }
    }

    outputSuccess(merged, { count: merged.length });
  } catch (error) {
    mapHttpError(error);
  }
}

function parseTagOps(raw: string): { mode: "replace" | "ops" | "direct"; tags: string[]; remove: string[] } {
  if (raw.startsWith("=")) {
    return { mode: "replace", tags: parseTags(raw.slice(1)), remove: [] };
  }

  const tokens = parseTags(raw);
  const add: string[] = [];
  const remove: string[] = [];
  let hasOps = false;

  for (const token of tokens) {
    if (token.startsWith("+")) {
      hasOps = true;
      add.push(token.slice(1));
      continue;
    }
    if (token.startsWith("-")) {
      hasOps = true;
      remove.push(token.slice(1));
      continue;
    }
    add.push(token);
  }

  return { mode: hasOps ? "ops" : "direct", tags: add, remove };
}

async function cmdUpdate(args: string[]): Promise<void> {
  const parsed = parseFlags(args, {
    "--title": { key: "title", type: "string" },
    "--tags": { key: "tags", type: "string" },
    "--collection": { key: "collection", type: "string" },
    "--important": { key: "important", type: "string" },
    "--note": { key: "note", type: "string" }
  });

  if (parsed.positionals.length > 1) {
    failInvalid("update accepts at most one positional <id>");
  }

  const title = typeof parsed.values.title === "string" ? parsed.values.title : undefined;
  const note = typeof parsed.values.note === "string" ? parsed.values.note : undefined;
  const collection = parseOptionalInteger(parsed.values.collection, "collection");
  const important = typeof parsed.values.important === "string" ? parseBooleanLiteral(parsed.values.important, "important") : undefined;
  const rawTags = typeof parsed.values.tags === "string" ? parsed.values.tags : undefined;

  const idValue = parsed.positionals[0];
  if (typeof idValue === "string") {
    const id = parseInteger(idValue, "id");
    const token = requireToken();
    const payload: Record<string, unknown> = {};
    if (title) payload.title = title;
    if (note) payload.note = note;
    if (typeof collection === "number") payload.collection = collection;
    if (typeof important === "boolean") payload.important = important;

    try {
      if (rawTags) {
        const tagOps = parseTagOps(rawTags);
        if (tagOps.mode === "replace" || tagOps.mode === "direct") {
          payload.tags = tagOps.tags;
        } else {
          const existing = await requestJson("GET", `/raindrop/${id}`, token) as { item?: { tags?: string[] } };
          const baseTags = Array.isArray(existing.item?.tags) ? existing.item?.tags : [];
          const next = baseTags.filter((tag) => !tagOps.remove.includes(tag));
          for (const tag of tagOps.tags) {
            if (!next.includes(tag)) next.push(tag);
          }
          payload.tags = next;
        }
      }

      const response = await requestJson("PUT", `/raindrop/${id}`, token, { body: payload });
      outputSuccess(extractItem(response));
    } catch (error) {
      mapHttpError(error);
    }
    return;
  }

  // Batch mode via stdin.
  const lines = readStdinLines();
  if (lines.length === 0) {
    failInvalid("update requires <id> or stdin ids");
  }

  if (!rawTags) {
    failInvalid("batch update requires --tags with +prefix semantics");
  }

  const tagOps = parseTagOps(rawTags);
  if (tagOps.mode !== "ops" || tagOps.remove.length > 0) {
    failInvalid("batch update only supports tag addition using +tag");
  }

  const ids = lines.map((line) => parseInteger(line, "id"));
  const token = requireToken();

  try {
    const response = await requestJson("PUT", "/raindrop/multi", token, {
      body: {
        ids,
        tags: tagOps.tags
      }
    });
    outputSuccess(extractItem(response));
  } catch (error) {
    mapHttpError(error);
  }
}

async function cmdRm(args: string[]): Promise<void> {
  const parsed = parseFlags(args, {
    "--permanent": { key: "permanent", type: "boolean" }
  });

  if (parsed.positionals.length !== 1) {
    failInvalid("rm requires exactly one <id>");
  }

  const id = parseInteger(requirePositional(parsed.positionals, 0, "rm requires exactly one <id>"), "id");
  const permanent = parsed.values.permanent === true;
  const token = requireToken();

  try {
    const response = await requestJson("DELETE", `/raindrop/${id}`, token, {
      query: permanent ? { permanent: true } : undefined
    });
    outputSuccess(extractItem(response));
  } catch (error) {
    mapHttpError(error);
  }
}

async function cmdLs(args: string[]): Promise<void> {
  const parsed = parseFlags(args, {
    "--all": { key: "all", type: "boolean" },
    "--collection": { key: "collection", type: "string" },
    "--tag": { key: "tag", type: "string" },
    "--type": { key: "type", type: "string" },
    "--important": { key: "important", type: "boolean" },
    "--sort": { key: "sort", type: "string" },
    "--limit": { key: "limit", type: "string" },
    "--ids-only": { key: "idsOnly", type: "boolean" },
    "--notag": { key: "notag", type: "boolean" },
    "--broken": { key: "broken", type: "boolean" },
    "--page": { key: "page", type: "string" }
  });

  if (parsed.positionals.length > 1) {
    failInvalid("ls accepts at most one positional [collection]");
  }

  const positionalCollection = parsed.positionals[0];
  const collection = typeof positionalCollection === "string"
    ? parseInteger(positionalCollection, "collection")
    : parseOptionalInteger(parsed.values.collection, "collection");

  const all = parsed.values.all === true;
  const idsOnly = parsed.values.idsOnly === true;
  const brokenOnly = parsed.values.broken === true;
  const limit = parseOptionalInteger(parsed.values.limit, "limit") ?? 25;
  const startPage = parseOptionalInteger(parsed.values.page, "page") ?? 0;
  const collectionId = collection ?? 0;
  const sort = typeof parsed.values.sort === "string" ? parsed.values.sort : "-created";
  const tag = typeof parsed.values.tag === "string" ? parsed.values.tag : undefined;
  const type = typeof parsed.values.type === "string" ? parsed.values.type : undefined;
  const notag = parsed.values.notag === true;
  const important = parsed.values.important === true;

  const searchParts: string[] = [];
  if (tag) searchParts.push(`#${tag}`);
  if (type) searchParts.push(`type:${type}`);
  if (notag) searchParts.push("notag:true");
  if (important) searchParts.push("important:true");

  const token = requireToken();
  const results: Record<string, unknown>[] = [];
  let page = startPage;

  try {
    while (true) {
      const response = await requestJson("GET", `/raindrops/${collectionId}`, token, {
        query: {
          // Keep legacy query keys for compatibility with existing contract tests.
          collection,
          limit,
          perpage: limit,
          page,
          sort,
          search: searchParts.length > 0 ? searchParts.join(" ") : undefined
        }
      });

      let items = extractItems(response) as Array<Record<string, unknown>>;
      if (brokenOnly) {
        items = items.filter((item) => item.broken === true);
      }
      results.push(...items);

      if (!all) break;
      const responseItems = extractItems(response);
      if (responseItems.length === 0) break;
      page += 1;
    }

    if (idsOnly) {
      outputSuccess(
        results
          .map((item) => (typeof item.id === "number" ? item.id : item._id))
          .filter((id): id is number => typeof id === "number"),
        { count: results.length, page: startPage, total: results.length }
      );
      return;
    }

    outputSuccess(results, { count: results.length, page: startPage, total: results.length });
  } catch (error) {
    mapHttpError(error);
  }
}

async function cmdCollections(args: string[]): Promise<void> {
  const parsed = parseFlags(args, {
    "--tree": { key: "tree", type: "boolean" },
    "--ids-only": { key: "idsOnly", type: "boolean" }
  });

  if (parsed.positionals.length !== 0) {
    failInvalid("collections does not accept positional arguments");
  }

  const tree = parsed.values.tree === true;
  const idsOnly = parsed.values.idsOnly === true;
  const token = requireToken();

  try {
    const response = await requestJson("GET", "/collections", token, {
      query: { tree: tree || undefined }
    });
    const items = extractItems(response) as Array<Record<string, unknown>>;

    if (idsOnly) {
      outputSuccess(items.map((item) => item.id).filter((id): id is number => typeof id === "number"));
      return;
    }

    outputSuccess(items);
  } catch (error) {
    mapHttpError(error);
  }
}

async function cmdTags(args: string[]): Promise<void> {
  const parsed = parseFlags(args, {
    "--sort": { key: "sort", type: "string" },
    "--collection": { key: "collection", type: "string" }
  });

  if (parsed.positionals.length > 1) {
    failInvalid("tags accepts at most one positional [collection]");
  }

  const positionalCollection = parsed.positionals[0];
  const collection = typeof positionalCollection === "string"
    ? parseInteger(positionalCollection, "collection")
    : parseOptionalInteger(parsed.values.collection, "collection");
  const sort = typeof parsed.values.sort === "string" ? parsed.values.sort : "count";
  if (sort !== "count" && sort !== "name") {
    failInvalid("tags --sort must be count or name");
  }

  const token = requireToken();

  try {
    const response = await requestJson("GET", "/tags", token, {
      query: { collection }
    });

    const items = extractItems(response) as Array<{ tag?: string; count?: number }>;
    if (sort === "count") {
      items.sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
    } else {
      items.sort((a, b) => (a.tag ?? "").localeCompare(b.tag ?? ""));
    }
    outputSuccess(items);
  } catch (error) {
    mapHttpError(error);
  }
}

async function cmdStatus(args: string[]): Promise<void> {
  if (args.length !== 0) {
    failInvalid("status does not accept arguments");
  }
  const token = requireToken();
  try {
    const response = await requestJson("GET", "/status", token);
    outputSuccess(response);
  } catch (error) {
    mapHttpError(error);
  }
}

async function cmdCollection(args: string[]): Promise<void> {
  if (args.length === 0) {
    failInvalid("collection requires a subcommand: create|update|rm");
  }

  const [subcommand, ...rest] = args;
  const token = requireToken();

  if (subcommand === "create") {
    const parsed = parseFlags(rest, {
      "--parent": { key: "parent", type: "string" },
      "--public": { key: "public", type: "boolean" }
    });
    if (parsed.positionals.length !== 1) {
      failInvalid("collection create requires <title>");
    }

    const title = requirePositional(parsed.positionals, 0, "collection create requires <title>");
    const parent = parseOptionalInteger(parsed.values.parent, "parent");
    const isPublic = parsed.values.public === true;

    try {
      const response = await requestJson("POST", "/collection", token, {
        body: {
          title,
          ...(typeof parent === "number" ? { parent } : {}),
          ...(isPublic ? { public: true } : {})
        }
      });
      outputSuccess(extractItem(response));
      return;
    } catch (error) {
      mapHttpError(error);
    }
  }

  if (subcommand === "update") {
    const parsed = parseFlags(rest, {
      "--title": { key: "title", type: "string" },
      "--parent": { key: "parent", type: "string" },
      "--view": { key: "view", type: "string" }
    });
    if (parsed.positionals.length !== 1) {
      failInvalid("collection update requires <id>");
    }
    const id = parseInteger(requirePositional(parsed.positionals, 0, "collection update requires <id>"), "id");

    const payload: Record<string, unknown> = {};
    if (typeof parsed.values.title === "string") payload.title = parsed.values.title;
    if (typeof parsed.values.parent === "string") payload.parent = parseInteger(parsed.values.parent, "parent");
    if (typeof parsed.values.view === "string") payload.view = parsed.values.view;

    try {
      const response = await requestJson("PUT", `/collection/${id}`, token, {
        body: payload
      });
      outputSuccess(extractItem(response));
      return;
    } catch (error) {
      mapHttpError(error);
    }
  }

  if (subcommand === "rm") {
    const parsed = parseFlags(rest, {});
    if (parsed.positionals.length !== 1) {
      failInvalid("collection rm requires <id>");
    }
    const id = parseInteger(requirePositional(parsed.positionals, 0, "collection rm requires <id>"), "id");

    try {
      const response = await requestJson("DELETE", `/collection/${id}`, token);
      outputSuccess(extractItem(response));
      return;
    } catch (error) {
      mapHttpError(error);
    }
  }

  failInvalid(`Unknown collection subcommand: ${subcommand}`);
}

function robotDocsData(): Record<string, JsonValue> {
  return {
    commands: {
      search: { args: ["query:string"], flags: ["--collection", "--sort", "--limit", "--page", "--fields"] },
      get: { args: ["id:int"], flags: ["--fields"] },
      add: { args: ["url:string?"], flags: ["--title", "--tags", "--collection", "--parse", "--from-suggest"] },
      update: { args: ["id:int?"], flags: ["--title", "--tags", "--collection", "--important", "--note"] },
      rm: { args: ["id:int"], flags: ["--permanent"] },
      ls: { args: ["collection:int?"], flags: ["--all", "--tag", "--type", "--important", "--sort", "--limit", "--ids-only", "--notag", "--broken", "--page"] },
      collections: { args: [], flags: ["--tree", "--ids-only"] },
      collection: { args: ["create|update|rm"], flags: [] },
      tags: { args: ["collection:int?"], flags: ["--sort"] },
      status: { args: [], flags: [] },
      exists: { args: ["url:string?"], flags: [] },
      suggest: { args: ["url:string"], flags: [] },
      highlights: { args: ["collection:int?"], flags: ["--color", "--limit"] },
      export: { args: ["collection:int?"], flags: ["--format", "--fields"] },
      watch: { args: [], flags: ["--since", "--collection"] },
      "robot-docs": { args: [], flags: [] }
    },
    common_flags: ["--json", "--limit", "--fields", "--collection", "--sort", "--page", "--all", "--ids-only"],
    exit_codes: {
      "0": "success",
      "1": "not found",
      "2": "bad args",
      "3": "auth",
      "4": "rate limit",
      "5": "api/network error"
    },
    auth: "RAINDROP_TOKEN env var or ~/.config/rain/token"
  };
}

async function cmdRobotDocs(args: string[]): Promise<void> {
  if (args.length !== 0) {
    failInvalid("robot-docs does not accept arguments");
  }
  outputSuccess(robotDocsData());
}

async function cmdExists(args: string[]): Promise<void> {
  const parsed = parseFlags(args, {});
  if (parsed.positionals.length > 1) {
    failInvalid("exists accepts at most one positional <url>");
  }

  const token = requireToken();
  const maybeUrl = parsed.positionals[0];

  if (typeof maybeUrl === "string") {
    const normalized = normalizeUrl(maybeUrl);
    try {
      const response = await requestJson("GET", "/exists", token, {
        query: { url: normalized }
      }) as { found?: { id?: number } | null };

      if (response.found && typeof response.found.id === "number") {
        outputSuccess({ id: response.found.id }, undefined, 0);
      } else {
        outputSuccess(null, undefined, 1);
      }
      return;
    } catch (error) {
      mapHttpError(error);
    }
  }

  const lines = readStdinLines();
  if (lines.length === 0) {
    failInvalid("exists requires <url> or stdin input");
  }

  try {
    const response = await requestJson("POST", "/exists", token, {
      body: { urls: lines }
    });
    const items = extractItems(response);
    outputSuccess(items, undefined, 0);
  } catch (error) {
    mapHttpError(error);
  }
}

async function cmdSuggest(args: string[]): Promise<void> {
  const parsed = parseFlags(args, {});
  if (parsed.positionals.length !== 1) {
    failInvalid("suggest requires exactly one <url>");
  }

  const url = requirePositional(parsed.positionals, 0, "suggest requires exactly one <url>");
  validateUrl(url);
  const token = requireToken();

  try {
    const response = await requestJson("GET", "/suggest", token, {
      query: { url }
    }) as { collections?: unknown[]; tags?: unknown[] };

    outputSuccess({
      collections: Array.isArray(response.collections) ? response.collections : [],
      tags: Array.isArray(response.tags) ? response.tags : []
    });
  } catch (error) {
    mapHttpError(error);
  }
}

async function cmdHighlights(args: string[]): Promise<void> {
  const parsed = parseFlags(args, {
    "--color": { key: "color", type: "string" },
    "--limit": { key: "limit", type: "string" },
    "--collection": { key: "collection", type: "string" }
  });

  if (parsed.positionals.length > 1) {
    failInvalid("highlights accepts at most one positional [collection]");
  }

  const positionalCollection = parsed.positionals[0];
  const collection = typeof positionalCollection === "string"
    ? parseInteger(positionalCollection, "collection")
    : parseOptionalInteger(parsed.values.collection, "collection");
  const limit = parseOptionalInteger(parsed.values.limit, "limit");
  const color = typeof parsed.values.color === "string" ? parsed.values.color : undefined;
  const token = requireToken();

  try {
    const response = await requestJson("GET", "/highlights", token, {
      query: {
        collection,
        limit
      }
    });
    let items = extractItems(response) as Array<Record<string, unknown>>;
    if (color) {
      items = items.filter((item) => item.color === color);
    }
    outputSuccess(items, { count: items.length });
  } catch (error) {
    mapHttpError(error);
  }
}

async function fetchAllRaindrops(
  token: string,
  query: Record<string, string | number | boolean | undefined>
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  const maxPages = 200;
  const queryLimit = typeof query.limit === "number"
    ? query.limit
    : typeof query.limit === "string" && /^\d+$/.test(query.limit)
      ? Number(query.limit)
      : 50;
  const pageSize = queryLimit > 0 ? queryLimit : 50;
  let expectedTotal: number | undefined;
  let page = 0;
  while (page < maxPages) {
    const response = await requestJson("GET", "/raindrops", token, {
      query: {
        ...query,
        page
      }
    });
    const items = extractItems(response) as Array<Record<string, unknown>>;
    const responseObj = response as { count?: number };
    if (typeof responseObj.count === "number" && Number.isFinite(responseObj.count)) {
      expectedTotal = responseObj.count;
    }
    if (items.length === 0) {
      break;
    }
    out.push(...items);
    if (typeof expectedTotal === "number" && out.length >= expectedTotal) {
      break;
    }
    if (items.length < pageSize) {
      break;
    }
    page += 1;
  }
  return out;
}

async function cmdExport(args: string[]): Promise<void> {
  const parsed = parseFlags(args, {
    "--format": { key: "format", type: "string" },
    "--fields": { key: "fields", type: "string" }
  });

  if (parsed.positionals.length > 1) {
    failInvalid("export accepts at most one positional [collection]");
  }

  const positionalCollection = parsed.positionals[0];
  const collection = typeof positionalCollection === "string"
    ? parseInteger(positionalCollection, "collection")
    : undefined;
  const format = typeof parsed.values.format === "string" ? parsed.values.format : "json";
  const fields = typeof parsed.values.fields === "string" ? parseTags(parsed.values.fields) : undefined;

  if (format !== "json" && format !== "csv") {
    failInvalid("export --format must be json or csv");
  }

  if (format === "csv" && fields && fields.length > 0) {
    const requiredCsvFields = ["id", "title", "link"];
    const matchesRequired = fields.length === requiredCsvFields.length
      && fields.every((field, index) => field === requiredCsvFields[index]);
    if (!matchesRequired) {
      failInvalid("export csv --fields must be exactly id,title,link");
    }
  }

  const token = requireToken();

  try {
    const items = await fetchAllRaindrops(token, {
      limit: 50,
      sort: "-created",
      collection
    });

    if (format === "csv") {
      const csvFields = fields && fields.length > 0 ? fields : ["id", "title", "link"];
      const csv = toCsv(items, csvFields);
      outputSuccess(csv);
      return;
    }

    if (fields && fields.length > 0) {
      outputSuccess(applyFieldsProjection(items, fields), { count: items.length });
      return;
    }

    outputSuccess(items, { count: items.length });
  } catch (error) {
    mapHttpError(error);
  }
}

async function cmdWatch(args: string[]): Promise<void> {
  const parsed = parseFlags(args, {
    "--since": { key: "since", type: "string" },
    "--collection": { key: "collection", type: "string" }
  });

  if (parsed.positionals.length !== 0) {
    failInvalid("watch does not accept positional args");
  }

  if (typeof parsed.values.since !== "string") {
    failInvalid("watch requires --since <timestamp>");
  }

  const sinceMs = parseIsoTimestamp(parsed.values.since);
  const overlapMs = 60_000;
  const thresholdMs = sinceMs - overlapMs;
  const collection = parseOptionalInteger(parsed.values.collection, "collection");
  const token = requireToken();

  const seenIds = new Set<number>();
  const fresh: Array<Record<string, unknown>> = [];
  let page = 0;

  try {
    while (true) {
      const response = await requestJson("GET", "/raindrops", token, {
        query: {
          sort: "-lastUpdate",
          limit: 50,
          page,
          collection
        }
      });
      const items = extractItems(response) as Array<Record<string, unknown>>;
      if (items.length === 0) {
        break;
      }

      let reachedOld = false;
      for (const item of items) {
        const id = typeof item.id === "number" ? item.id : undefined;
        const rawUpdate = typeof item.lastUpdate === "string" ? item.lastUpdate : undefined;
        const updatedMs = rawUpdate ? Date.parse(rawUpdate) : Number.NaN;

        if (!Number.isFinite(updatedMs)) {
          continue;
        }

        if (updatedMs > thresholdMs) {
          if (typeof id === "number" && !seenIds.has(id)) {
            seenIds.add(id);
            fresh.push(item);
          }
          continue;
        }

        reachedOld = true;
      }

      if (reachedOld) {
        break;
      }
      page += 1;
    }

    const strict = fresh.filter((item) => {
      const updated = typeof item.lastUpdate === "string" ? Date.parse(item.lastUpdate) : Number.NaN;
      return Number.isFinite(updated) && updated > sinceMs;
    });

    outputSuccess(strict, { count: strict.length });
  } catch (error) {
    mapHttpError(error);
  }
}

async function dispatch(args: string[]): Promise<void> {
  const { commandArgs } = parseGlobal(args);
  const [command, ...rest] = commandArgs;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "version" || command === "--version" || command === "-v") {
    printVersion();
    return;
  }

  switch (command) {
    case "search":
      await cmdSearch(rest);
      return;
    case "get":
      await cmdGet(rest);
      return;
    case "add":
      await cmdAdd(rest);
      return;
    case "update":
      await cmdUpdate(rest);
      return;
    case "rm":
      await cmdRm(rest);
      return;
    case "ls":
      await cmdLs(rest);
      return;
    case "collections":
      await cmdCollections(rest);
      return;
    case "collection":
      await cmdCollection(rest);
      return;
    case "tags":
      await cmdTags(rest);
      return;
    case "status":
      await cmdStatus(rest);
      return;
    case "robot-docs":
      await cmdRobotDocs(rest);
      return;
    case "exists":
      await cmdExists(rest);
      return;
    case "suggest":
      await cmdSuggest(rest);
      return;
    case "highlights":
      await cmdHighlights(rest);
      return;
    case "export":
      await cmdExport(rest);
      return;
    case "watch":
      await cmdWatch(rest);
      return;
    default:
      failInvalid(`Unknown command: ${command}`);
  }
}

async function main(): Promise<void> {
  try {
    await dispatch(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliError) {
      outputError(
        {
          code: error.code,
          message: error.message,
          suggest: error.suggest
        },
        error.exitCode
      );
      return;
    }

    const message = isError(error) ? error.message : "Unexpected failure";
    outputError(
      {
        code: "API_ERROR",
        message,
        suggest: ERROR_SUGGESTIONS.API_ERROR ?? ["Retry later or run `rain status --json` for diagnostics."]
      },
      5
    );
  } finally {
    process.exit(process.exitCode ?? 0);
  }
}

void main();
