// Tiny HTTP client for the daemon's unix socket. Every call has a timeout and never hangs a caller.
import { request } from "node:http";

export interface HealthResponse {
  ok: boolean;
  version: string;
  buildId: string;
  pid: number;
  root: string;
  startedAt: string;
  watching: boolean;
  indexing: boolean;
  lastIndex: { at: string; mode: string; ms: number; files: number; error: string | null } | null;
}

export function call<T>(
  socket: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  timeoutMs = 2000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        socketPath: socket,
        // No connection pooling: Node's default agent keeps connections alive per socket path, and a pooled connection
        // can still point at a daemon that has since been replaced (found by the M2 review #2 test).
        agent: false,
        method,
        path,
        timeout: timeoutMs,
        headers: payload
          ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
          : {},
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => {
          data += c;
        });
        res.on("end", () => {
          try {
            const json = JSON.parse(data) as T & { error?: string };
            if ((res.statusCode ?? 500) >= 400)
              reject(new Error(json.error ?? `daemon returned ${res.statusCode}`));
            else resolve(json);
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on("timeout", () =>
      req.destroy(new Error(`daemon did not answer ${method} ${path} within ${timeoutMs} ms`)),
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export const health = (socket: string, timeoutMs = 1000) =>
  call<HealthResponse>(socket, "GET", "/health", undefined, timeoutMs);
