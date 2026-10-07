// S4 daemon stub: one HTTP handler on a unix socket AND loopback TCP, returning a canned decision.
// Measures transport cost only; real policy evaluation is not modeled.
import { rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

const SOCK = "data/s4.sock";

function handler(req: IncomingMessage, res: ServerResponse): void {
  let body = "";
  req.setEncoding("utf8");
  req.on("data", (c: string) => {
    body += c;
  });
  req.on("end", () => {
    const event = JSON.parse(body) as { tool_name?: string };
    const decision =
      event.tool_name === "Edit"
        ? {
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              additionalContext: "lib/format.ts: 12 direct dependents",
            },
          }
        : {};
    const out = JSON.stringify(decision);
    res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(out) });
    res.end(out);
  });
}

rmSync(SOCK, { force: true });
const unix = createServer(handler);
const tcp = createServer(handler);
unix.listen(SOCK);
tcp.listen(0, "127.0.0.1", () => {
  const { port } = tcp.address() as AddressInfo;
  writeFileSync("data/s4.port", String(port));
  console.error(`s4 daemon: unix ${SOCK}, tcp 127.0.0.1:${port}`);
});
