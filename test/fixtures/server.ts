import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface FixtureRoute {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
}

export interface Fixture {
  origin: string;
  close: () => Promise<void>;
}

/** Start a throwaway HTTP server that replies from a fixed routing table. */
export async function startFixture(
  routes: Record<string, FixtureRoute>,
): Promise<Fixture> {
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    const route = routes[path];
    if (!route) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(route.status ?? 200, {
      "content-type": "text/html; charset=utf-8",
      ...route.headers,
    });
    res.end(route.body ?? "");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}
