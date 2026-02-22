import { randomUUID } from "node:crypto";

export type MockJson = string | number | boolean | null | MockJson[] | { [key: string]: MockJson };

export type MockRequest = {
  id: string;
  method: string;
  pathname: string;
  search: string;
  query: URLSearchParams;
  headers: Headers;
  text: string;
  json: unknown;
};

type MockReply = {
  status?: number;
  headers?: Record<string, string>;
  json?: MockJson;
  text?: string;
};

type MockHandler = (request: MockRequest) => MockReply | Promise<MockReply>;

type RouteDef = {
  method: string;
  pathname: string;
  handler: MockHandler;
};

const defaultFallback: MockHandler = () => ({
  status: 500,
  json: {
    error: "UNHANDLED_ROUTE",
    message: "Mock route was not configured for this request"
  }
});

export class MockRaindropServer {
  private server: Bun.Server<unknown> | null = null;
  private readonly routes: RouteDef[] = [];
  private fallback: MockHandler = defaultFallback;
  readonly requests: MockRequest[] = [];

  get baseUrl(): string {
    if (!this.server) {
      throw new Error("Mock server not started");
    }
    return `http://127.0.0.1:${this.server.port}`;
  }

  start(): void {
    if (this.server) return;

    this.server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => this.handle(request)
    });
  }

  stop(): void {
    if (!this.server) return;
    this.server.stop(true);
    this.server = null;
  }

  reset(): void {
    this.requests.length = 0;
    this.routes.length = 0;
    this.fallback = defaultFallback;
  }

  on(method: string, pathname: string, handler: MockHandler): void {
    this.routes.push({ method: method.toUpperCase(), pathname, handler });
  }

  all(pathname: string, handler: MockHandler): void {
    this.routes.push({ method: "*", pathname, handler });
  }

  setFallback(handler: MockHandler): void {
    this.fallback = handler;
  }

  count(method: string, pathname: string): number {
    return this.requests.filter((request) => request.method === method.toUpperCase() && request.pathname === pathname).length;
  }

  private async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const text = await request.text();
    const method = request.method.toUpperCase();
    const pathname = url.pathname;

    let parsedJson: unknown = null;
    if (text.trim().length > 0) {
      try {
        parsedJson = JSON.parse(text);
      } catch {
        parsedJson = null;
      }
    }

    const entry: MockRequest = {
      id: randomUUID(),
      method,
      pathname,
      search: url.search,
      query: url.searchParams,
      headers: request.headers,
      text,
      json: parsedJson
    };
    this.requests.push(entry);

    const handler = this.resolveHandler(method, pathname);
    const reply = await handler(entry);
    const status = reply.status ?? 200;
    const headers = new Headers(reply.headers);

    if (typeof reply.text === "string") {
      return new Response(reply.text, { status, headers });
    }

    headers.set("content-type", "application/json");
    return new Response(JSON.stringify(reply.json ?? null), { status, headers });
  }

  private resolveHandler(method: string, pathname: string): MockHandler {
    for (const route of this.routes) {
      if (route.method === method && route.pathname === pathname) {
        return route.handler;
      }
    }

    for (const route of this.routes) {
      if (route.method === method && route.pathname.endsWith("*")) {
        const prefix = route.pathname.slice(0, -1);
        if (pathname.startsWith(prefix)) {
          return route.handler;
        }
      }
    }

    for (const route of this.routes) {
      if (route.method === "*" && route.pathname === pathname) {
        return route.handler;
      }
    }

    for (const route of this.routes) {
      if (route.method === "*" && route.pathname.endsWith("*")) {
        const prefix = route.pathname.slice(0, -1);
        if (pathname.startsWith(prefix)) {
          return route.handler;
        }
      }
    }

    return this.fallback;
  }
}

export async function withMockRaindrop<T>(fn: (server: MockRaindropServer) => Promise<T> | T): Promise<T> {
  const server = new MockRaindropServer();
  server.start();
  try {
    return await fn(server);
  } finally {
    server.stop();
  }
}
